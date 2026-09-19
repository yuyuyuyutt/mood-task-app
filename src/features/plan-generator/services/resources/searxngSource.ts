// src/features/plan-generator/services/resources/searxngSource.ts
// 第二层（默认关闭）：本地 SearXNG 实例。
// - 调用 JSON 接口：GET {base}/search?q=...&format=json[&engines=douban,zhihu]
// - 桌面端（Tauri）走 Rust 侧代理，绕开浏览器同源策略；浏览器端直连（预期被 CORS 拦）；
// - 用于补充文章 / 书籍 / 技术帖等非视频资源；
// - 未配置、未开启或调用失败 → 静默跳过（不抛错，由上层记录降级说明）；
// - 仅保存标题 / URL / 摘要 / 引擎等元数据，不保存正文。
//
// 注意：SearXNG 默认只输出 html，`format=json` 未在 search.formats 白名单时会返回 403，
// 需要在实例的 settings.yml 中补上 json 并重启。
import type { ManualResource, NetworkingSettings, ResourceDifficulty, ResourceItem, ResourceType } from '../../types';
import { isTauriRuntime } from '../../../../utils/runtime';

/** 引擎 → 资源类型 / 可信度 */
const ENGINE_MAP: Record<string, { type: ResourceType; credibility: number }> = {
  douban: { type: 'book', credibility: 0.85 },
  zhihu: { type: 'article', credibility: 0.8 },
  juejin: { type: 'post', credibility: 0.8 },
  github: { type: 'post', credibility: 0.85 },
  stackoverflow: { type: 'post', credibility: 0.85 },
  wikipedia: { type: 'article', credibility: 0.9 },
  bilibili: { type: 'video', credibility: 0.75 },
  youtube: { type: 'video', credibility: 0.75 },
  bing: { type: 'article', credibility: 0.6 },
  google: { type: 'article', credibility: 0.6 },
  duckduckgo: { type: 'article', credibility: 0.6 },
  baidu: { type: 'article', credibility: 0.55 },
};

export interface SearxngResult {
  ok: boolean;
  items: ResourceItem[];
  error?: string;
  skipped?: boolean;
}

interface SearxngRaw {
  url?: string;
  title?: string;
  content?: string;
  engine?: string;
  publishedDate?: string | null;
  score?: number;
  category?: string;
}

/** 从搜索结果推断难度（关键词启发式，仅作排序参考） */
export function inferDifficulty(title: string, snippet?: string): ResourceDifficulty {
  const text = `${title} ${snippet ?? ''}`;
  if (/(入门|零基础|初学|新手|基础|从零|快速上手|hello\s*world)/i.test(text)) return 'beginner';
  if (/(进阶|深入|原理|源码|架构|高级|优化|剖析)/i.test(text)) return 'advanced';
  if (/(实践|练手|项目|案例|教程|指南|实战)/i.test(text)) return 'intermediate';
  return 'unknown';
}

/** 引擎 → 类型/可信度（导出便于测试） */
export function engineProfile(engine?: string): { type: ResourceType; credibility: number } {
  const key = (engine ?? '').toLowerCase();
  return ENGINE_MAP[key] ?? { type: 'article', credibility: 0.6 };
}

/** 把 SearXNG 结果映射为统一资源结构 */
export function mapSearxngResults(
  results: SearxngRaw[],
  keyword: string,
  hash: (input: string) => string,
): ResourceItem[] {
  const out: ResourceItem[] = [];
  for (const r of results) {
    const url = typeof r.url === 'string' ? r.url : '';
    const title = (r.title ?? '').replace(/\s+/g, ' ').trim();
    if (!/^https?:\/\//.test(url) || title.length < 2) continue;
    const profile = engineProfile(r.engine);
    const snippet = (r.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    out.push({
      id: `searxng:${hash(url)}`,
      source: 'searxng',
      layer: 2,
      type: profile.type,
      title: title.slice(0, 160),
      url,
      publishedAt: r.publishedDate ? String(r.publishedDate).slice(0, 10) : undefined,
      snippet: snippet || undefined,
      difficulty: inferDifficulty(title, snippet),
      keyword,
      metrics: typeof r.score === 'number' ? { views: undefined } : undefined,
    });
  }
  return out;
}

function buildSearchUrl(settings: NetworkingSettings, keyword: string): string {
  const base = settings.searxngBaseUrl.replace(/\/+$/, '');
  const params = new URLSearchParams({ q: keyword, format: 'json', language: 'zh-CN' });
  if (settings.searxngEngines.length > 0) params.set('engines', settings.searxngEngines.join(','));
  return `${base}/search?${params.toString()}`;
}

/** 是否具备调用条件（未开启/未配置地址 → 跳过，不算失败） */
export function shouldSkipSearxng(settings: NetworkingSettings): boolean {
  return !settings.searxng || settings.searxngBaseUrl.trim().length === 0;
}

/** Rust 侧 search_searxng 返回的条目（字段名与 Rust 结构体一致） */
interface RustSearxngItem {
  url: string;
  title: string;
  content?: string | null;
  engine?: string | null;
  published_date?: string | null;
  score?: number | null;
}

function rustItemToRaw(raw: RustSearxngItem): SearxngRaw {
  return {
    url: raw.url ?? undefined,
    title: raw.title ?? undefined,
    content: raw.content ?? undefined,
    engine: raw.engine ?? undefined,
    publishedDate: raw.published_date ?? undefined,
    score: typeof raw.score === 'number' ? raw.score : undefined,
  };
}

/**
 * 搜索 SearXNG。失败/超时/未配置都返回 ok:false（skipped 标记未配置），由上层静默降级。
 * 桌面端走 Rust 侧代理；浏览器端直连（预期被 CORS 拦并静默降级）。
 */
export async function searchSearxng(
  keyword: string,
  settings: NetworkingSettings,
  options: { signal?: AbortSignal; maxItems?: number; hash: (input: string) => string },
): Promise<SearxngResult> {
  if (shouldSkipSearxng(settings)) {
    return { ok: false, items: [], skipped: true, error: '未启用或未配置 SearXNG' };
  }
  const timeoutMs = settings.timeoutMs || 5000;
  const maxItems = options.maxItems ?? 20;

  // --- 桌面端：Rust 侧代理 ---
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const res = await invoke<{ items: RustSearxngItem[] }>('search_searxng', {
        keyword,
        baseUrl: settings.searxngBaseUrl,
        engines: settings.searxngEngines.length > 0 ? settings.searxngEngines : null,
        timeoutMs,
      });
      const raw = (res?.items ?? []).map(rustItemToRaw);
      const items = mapSearxngResults(raw, keyword, options.hash).slice(0, maxItems);
      return { ok: items.length > 0, items, error: items.length ? undefined : '无匹配结果' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, items: [], error: `Rust 代理失败：${msg}` };
    }
  }

  // --- 浏览器：直连（预期被 CORS 拦，由上层静默降级） ---
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(buildSearchUrl(settings, keyword), {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return { ok: false, items: [], error: `SearXNG HTTP ${res.status}` };
    const data = (await res.json()) as { results?: SearxngRaw[]; error?: string };
    if (data.error) return { ok: false, items: [], error: `SearXNG 返回错误：${data.error}` };
    const items = mapSearxngResults(data.results ?? [], keyword, options.hash).slice(0, maxItems);
    return { ok: items.length > 0, items, error: items.length ? undefined : '无匹配结果' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      items: [],
      error: msg.includes('abort') ? `SearXNG 请求超时（${timeoutMs}ms）` : `SearXNG 请求失败：${msg}`,
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

/** 资源库中的手动资源 → 统一结构（关键词命中标题/备注/关键词列表时纳入） */
export function matchManualResources(
  manual: ManualResource[],
  keyword: string,
  hash: (input: string) => string,
): ResourceItem[] {
  const kw = keyword.trim().toLowerCase();
  const tokens = kw.split(/\s+/).filter((t) => t.length >= 2);
  return manual
    .filter((m) => {
      if (tokens.length === 0) return false;
      const haystack = `${m.title} ${m.note ?? ''} ${(m.keywords ?? []).join(' ')}`.toLowerCase();
      return tokens.some((t) => haystack.includes(t));
    })
    .map((m) => ({
      id: `manual:${hash(m.url)}`,
      source: 'manual' as const,
      layer: 2 as const,
      type: m.type,
      title: m.title,
      url: m.url,
      author: m.author,
      difficulty: m.difficulty ?? 'unknown',
      snippet: m.note,
      keyword,
    }));
}
