// src/features/plan-generator/services/rag/contentFetcher.ts
// 正文抓取：**域名白名单 + 超时 + 体积上限 + 本地缓存**，任何一步不满足就直接放弃（不抛错给上层）。
//
// 三道闸门：
//   1) 白名单（前端，产品策略）：留空 = 一个都不抓；只能抓用户显式列出的域名；
//   2) 桌面端走 Rust 代理（`fetch_page_text`）：绕开 CORS，并在 Rust 侧再做 SSRF 防护
//      （拒绝本机 / 内网 / 链路本地地址）——前端白名单可被改，SSRF 判断是硬边界；
//   3) 体积与字数上限：下载字节上限在 Rust，IPC 与缓存的字数上限在这里。
import { getCachedContent, putCachedContent, CACHED_TEXT_LIMIT } from './contentCache';
import { isTauriRuntime } from '../../../../utils/runtime';

/** 单页保留的正文字符数上限（够切 ~12 块） */
export const MAX_FETCH_CHARS = CACHED_TEXT_LIMIT;

export interface FetchPageOptions {
  timeoutMs: number;
  /** 允许抓取的域名（空数组 = 一律不抓） */
  allowedDomains: string[];
  maxChars?: number;
  /** 是否允许读缓存（默认允许） */
  useCache?: boolean;
  signal?: AbortSignal;
}

export interface FetchPageResult {
  ok: boolean;
  url: string;
  title: string;
  text: string;
  /**
   * 正文的 Markdown 版本（桌面端由 Rust 从 HTML 结构转换而来）。
   * 只服务**阅读模式**：检索与证据流水线继续用 `text`（干净优先），阅读用 `markdown`（重点优先）。
   * 浏览器直连分支没有它（前端不做第二套 HTML 转换，避免与 Rust 实现漂移）。
   */
  markdown?: string;
  source: 'cache' | 'tauri' | 'browser';
  truncated?: boolean;
  error?: string;
}

/** 取 host 并统一小写、去掉 www.（白名单匹配用） */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

/**
 * 域名是否在白名单内：精确匹配或子域匹配（`bilibili.com` 允许 `www.bilibili.com` 与 `space.bilibili.com`）。
 * **空白名单一律拒绝** —— 这是刻意的默认值，避免"没配也能抓"。
 */
export function isDomainAllowed(url: string, allowedDomains: string[]): boolean {
  const host = hostOf(url);
  if (!host) return false;
  const list = allowedDomains.map(normalizeDomain).filter(Boolean);
  return list.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** 浏览器分支的降级清洗：没有 DOMParser 的场景（含单测）也能跑 */
export function stripHtmlLite(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function trim(text: string, maxChars: number): string {
  const clean = text.trim();
  return clean.length > maxChars ? clean.slice(0, maxChars) : clean;
}

/** Markdown 文案：空串一律收敛成 undefined，避免调用方到处判断空值 */
function markdownOf(value: string | undefined, maxChars: number): string | undefined {
  if (!value) return undefined;
  const trimmed = trim(value, maxChars);
  return trimmed || undefined;
}

/**
 * 抓取单个页面正文。**永不抛出**：所有失败都变成 `{ ok:false, error }`，
 * 由 evidence 层决定"跳过这一条继续"还是"整体降级"。
 */
export async function fetchPageText(
  url: string,
  options: FetchPageOptions,
): Promise<FetchPageResult> {
  const maxChars = Math.min(options.maxChars ?? MAX_FETCH_CHARS, MAX_FETCH_CHARS);
  const fail = (error: string): FetchPageResult => ({ ok: false, url, title: '', text: '', source: 'tauri', error });

  if (!/^https?:\/\//i.test(url)) return fail('只允许抓取 http(s) 链接');
  if (!isDomainAllowed(url, options.allowedDomains)) {
    return fail('域名不在正文抓取白名单内（可在设置页添加）');
  }
  if (options.signal?.aborted) return fail('已取消');

  // ---- 1) 本地缓存 ----
  if (options.useCache !== false) {
    try {
      const cached = await getCachedContent(url);
      if (cached) {
        return {
          ok: true,
          url,
          title: cached.title,
          text: trim(cached.text, maxChars),
          markdown: markdownOf(cached.markdown, maxChars),
          source: 'cache',
        };
      }
    } catch {
      // 缓存读失败不影响抓取
    }
  }

  // ---- 2) 桌面端：Rust 代理 ----
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const res = await invoke<{
        url: string;
        title: string;
        text: string;
        /** Rust 侧从 HTML 结构转换出的 Markdown；纯文本响应为空串 */
        markdown?: string;
        truncated: boolean;
      }>('fetch_page_text', { url, timeoutMs: options.timeoutMs, maxChars });
      const text = trim(res.text ?? '', maxChars);
      if (!text) return fail('页面没有可用正文（可能是纯脚本页 / 需要登录）');
      const markdown = markdownOf(res.markdown, maxChars);
      await putCachedContent({
        url,
        title: res.title ?? '',
        text,
        markdown,
        fetchedAt: new Date().toISOString(),
        hits: 0,
      }).catch(() => undefined);
      return {
        ok: true,
        url,
        title: res.title ?? '',
        text,
        markdown,
        source: 'tauri',
        truncated: res.truncated,
      };
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  // ---- 3) 浏览器：直连（大概率被 CORS 拦，静默降级） ----
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), options.timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      credentials: 'omit',
      headers: { Accept: 'text/html,application/xhtml+xml' },
    });
    if (!res.ok) return fail(`HTTP ${res.status}`);
    const raw = await res.text();
    const text = trim(stripHtmlLite(raw), maxChars);
    if (!text) return fail('页面没有可用正文');
    await putCachedContent({ url, title: '', text, fetchedAt: new Date().toISOString(), hits: 0 }).catch(
      () => undefined,
    );
    return { ok: true, url, title: '', text, source: 'browser' };
  } catch (err) {
    if (options.signal?.aborted) return fail('已取消');
    const msg = err instanceof Error ? err.message : String(err);
    return fail(
      /abort/i.test(msg)
        ? `抓取超时（${options.timeoutMs}ms）`
        : `抓取失败：${msg}（浏览器模式通常是被同源策略拦截，请在桌面端使用）`,
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
