// src/features/plan-generator/services/resources/bilibiliSource.ts
// 第一层（默认关闭）：B 站公开搜索接口。
//
// 实现要点：
// - 桌面端（Tauri）：走 Rust 侧代理 `search_bilibili`，绕开浏览器同源策略；
// - 浏览器开发环境：没有 IPC，直连必然因 CORS 失败（B 站不返回 Access-Control-Allow-Origin
//   且对无 Cookie 请求返回 403），此时静默降级到跳转按钮或 SearXNG；
// - 接口使用 /x/web-interface/wbi/search/type，实测无需 wbi 签名即返回 code:0；
// - 过滤广告与超长合集，只保留标题 / URL / 作者 / 时长 / 播放量 / 发布时间等元数据。
import type { ResourceItem } from '../../types';
import { isTauriRuntime } from '../../../../utils/runtime';

const SEARCH_TYPE_URL = 'https://api.bilibili.com/x/web-interface/wbi/search/type';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

const BASE_HEADERS: Record<string, string> = {
  'User-Agent': UA,
  Referer: 'https://www.bilibili.com/',
  Origin: 'https://www.bilibili.com',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

/** 超长合集过滤阈值（分钟） */
export const MAX_VIDEO_MINUTES = 180;
/** 合集类标题的额外收紧阈值 */
export const MAX_COLLECTION_MINUTES = 120;

/** 清洗 HTML 标签与实体（B 站搜索标题含 <em> 高亮） */
export function cleanHtml(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** '12:34' / '1:02:03' -> 分钟 */
export function parseDurationToMinutes(duration: unknown): number | undefined {
  if (typeof duration !== 'string' || !duration.includes(':')) return undefined;
  const parts = duration.split(':').map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) return undefined;
  if (parts.length === 2) return Math.round(parts[0] + parts[1] / 60);
  if (parts.length === 3) return Math.round(parts[0] * 60 + parts[1] + parts[2] / 60);
  return undefined;
}

const AD_PATTERN = /(广告|推广|带货|优惠券|加群|加微信|招生|报名咨询|限时特价)/;

/** 是否为广告或超长合集（需要过滤） */
export function isNoisyVideo(title: string, durationMinutes?: number): boolean {
  if (AD_PATTERN.test(title)) return true;
  if (durationMinutes != null) {
    if (durationMinutes > MAX_VIDEO_MINUTES) return true;
    if (/(合集|全集|完整版|100\s*集|全套)/.test(title) && durationMinutes > MAX_COLLECTION_MINUTES) return true;
  }
  return false;
}

interface BiliSearchItem {
  type?: string;
  bvid?: string;
  arcurl?: string;
  title?: string;
  author?: string;
  duration?: string;
  play?: number;
  favorites?: number;
  like?: number;
  pubdate?: number;
  description?: string;
}

function toIso(pubdate?: number): string | undefined {
  if (!pubdate || !Number.isFinite(pubdate)) return undefined;
  try {
    return new Date(pubdate * 1000).toISOString().slice(0, 10);
  } catch {
    return undefined;
  }
}

/** 把 B 站搜索结果条目转成统一资源结构（过滤广告/合集/非视频） */
export function mapBilibiliItems(
  items: BiliSearchItem[],
  keyword: string,
  hash: (input: string) => string,
): ResourceItem[] {
  const out: ResourceItem[] = [];
  for (const raw of items) {
    if (raw.type && raw.type !== 'video') continue;
    const title = cleanHtml(String(raw.title ?? ''));
    if (title.length < 2) continue;
    const url = raw.bvid
      ? `https://www.bilibili.com/video/${raw.bvid}`
      : raw.arcurl
        ? raw.arcurl.replace(/^http:/, 'https:')
        : '';
    if (!/^https:\/\//.test(url)) continue;
    const durationMinutes = parseDurationToMinutes(raw.duration);
    if (isNoisyVideo(title, durationMinutes)) continue;
    out.push({
      id: `bilibili:${hash(url || title)}`,
      source: 'bilibili',
      layer: 1,
      type: 'video',
      title,
      url,
      author: raw.author ? cleanHtml(String(raw.author)) : undefined,
      durationMinutes,
      publishedAt: toIso(raw.pubdate),
      metrics: {
        views: typeof raw.play === 'number' ? raw.play : undefined,
        likes: typeof raw.like === 'number' ? raw.like : undefined,
        favorites: typeof raw.favorites === 'number' ? raw.favorites : undefined,
      },
      snippet: raw.description ? cleanHtml(String(raw.description)).slice(0, 160) : undefined,
      difficulty: 'unknown',
      keyword,
    });
  }
  return out;
}

export interface BilibiliResult {
  ok: boolean;
  items: ResourceItem[];
  /** 降级/失败原因（静默降级时写入 ResourceBundle.warnings） */
  error?: string;
  /** 实际使用的接口（便于诊断） */
  endpoint?: 'search/type(rust)' | 'search/type(browser)';
}

/** 浏览器分支的直连请求（带超时与可取消） */
async function fetchJson(url: string, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: BASE_HEADERS, signal: ctrl.signal, credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Rust 侧 search_bilibili 返回的条目（字段名与 Rust 结构体一致） */
interface RustBilibiliItem {
  bvid: string;
  title: string;
  author?: string | null;
  duration?: string | null;
  play?: number | null;
  like?: number | null;
  favorites?: number | null;
  pubdate?: number | null;
  description?: string | null;
  arcurl?: string | null;
}

/** 统一把（Rust 或浏览器）条目交给同一套映射逻辑 */
function rustItemToSearchItem(raw: RustBilibiliItem): BiliSearchItem {
  return {
    type: 'video',
    bvid: raw.bvid ?? undefined,
    arcurl: raw.arcurl ?? undefined,
    title: raw.title ?? '',
    author: raw.author ?? undefined,
    duration: raw.duration ?? undefined,
    play: typeof raw.play === 'number' ? raw.play : undefined,
    favorites: typeof raw.favorites === 'number' ? raw.favorites : undefined,
    like: typeof raw.like === 'number' ? raw.like : undefined,
    pubdate: typeof raw.pubdate === 'number' ? raw.pubdate : undefined,
    description: raw.description ?? undefined,
  };
}

/**
 * 搜索 B 站视频。桌面端走 Rust 侧代理；浏览器端直连（预期失败并静默降级）。
 */
export async function searchBilibili(
  keyword: string,
  options: { timeoutMs?: number; signal?: AbortSignal; maxItems?: number; hash: (input: string) => string },
): Promise<BilibiliResult> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const maxItems = options.maxItems ?? 20;

  // --- 桌面端：Rust 侧代理（不受同源策略约束） ---
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const res = await invoke<{ items: RustBilibiliItem[]; endpoint: string }>('search_bilibili', {
        keyword,
        page: 1,
        timeoutMs,
      });
      const raw = (res?.items ?? []).map(rustItemToSearchItem);
      const items = mapBilibiliItems(raw, keyword, options.hash).slice(0, maxItems);
      return {
        ok: items.length > 0,
        items,
        endpoint: 'search/type(rust)',
        error: items.length ? undefined : '未匹配到合适视频',
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, items: [], error: `Rust 代理失败：${msg}` };
    }
  }

  // --- 浏览器：直连（B 站不返回 CORS 头，预期失败，由上层静默降级） ---
  try {
    const query = `${SEARCH_TYPE_URL}?search_type=video&keyword=${encodeURIComponent(keyword)}&page=1`;
    const data = (await fetchJson(query, timeoutMs, options.signal)) as {
      code?: number;
      message?: string;
      data?: { result?: BiliSearchItem[] };
    };
    if (data?.code === 0 && Array.isArray(data.data?.result)) {
      const items = mapBilibiliItems(data.data.result, keyword, options.hash).slice(0, maxItems);
      return {
        ok: items.length > 0,
        items,
        endpoint: 'search/type(browser)',
        error: items.length ? undefined : '未匹配到合适视频',
      };
    }
    return { ok: false, items: [], error: `B 站接口返回 code=${data?.code ?? '?'} ${data?.message ?? ''}`.trim() };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      items: [],
      error: `浏览器直连失败（CORS/风控，属预期）：${msg}`,
    };
  }
}
