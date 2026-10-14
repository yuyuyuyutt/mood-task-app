// src/features/plan-generator/services/rag/contentCache.ts
// 正文临时缓存：抓过的页面在 TTL 内复用，避免每次生成计划都去访问第三方站点。
//
// 隐私口径（重要）：本项目的承诺是"只保存标题与链接，不保存网页正文"。
// 因此这里**刻意把正文放在独立的 `contentCache` store**，而不是塞进会被整表导出的 `kv`：
//   - 不进数据备份（导出文件里不会出现网页正文）；
//   - 有 TTL（7 天）自动过期，且设置页可以一键清除；
//   - 单页截断 6000 字、最多 20 页，量级可控。
// 向量索引里只存向量与内容哈希，同样不含正文。
import {
  deleteContentCacheRows,
  getAllContentCacheRows,
  putContentCacheRows,
  type ContentCacheRow,
} from '../../db/plannerDB';
import { hashText } from './embedding';

/** 缓存有效期：7 天（抓正文属于"外发动作"，尽量少做、早期失效） */
export const CONTENT_CACHE_TTL_MS = 7 * 24 * 3600 * 1000;
/** 最多缓存多少页 */
export const CONTENT_CACHE_MAX_ENTRIES = 20;
/** 单页正文入库前的截断长度（够切 ~12 块） */
export const CACHED_TEXT_LIMIT = 6000;

export interface CachedContent {
  url: string;
  title: string;
  text: string;
  /** 正文的 Markdown 版本（阅读模式用；旧缓存没有该字段时回退纯文本） */
  markdown?: string;
  fetchedAt: string;
  /** 命中次数：淘汰时优先保留常用的 */
  hits: number;
}

export type ContentCacheMap = Record<string, CachedContent>;

export function contentCacheKey(url: string): string {
  return hashText(url);
}

/** 是否仍在有效期内（时间戳坏了视为过期，避免脏数据常驻） */
export function isFresh(
  entry: Pick<CachedContent, 'fetchedAt'>,
  now: Date = new Date(),
  ttlMs: number = CONTENT_CACHE_TTL_MS,
): boolean {
  const ts = Date.parse(entry.fetchedAt);
  if (!Number.isFinite(ts)) return false;
  return now.getTime() - ts <= ttlMs;
}

/**
 * 维护缓存：先丢过期条目，再按"最久未抓取"淘汰到上限以内。
 * 纯函数，便于单测（真实读写只有下面几个异步函数）。
 */
export function pruneContentCache(
  cache: ContentCacheMap,
  now: Date = new Date(),
  options: { ttlMs?: number; maxEntries?: number } = {},
): { cache: ContentCacheMap; removed: number } {
  const ttlMs = options.ttlMs ?? CONTENT_CACHE_TTL_MS;
  const maxEntries = options.maxEntries ?? CONTENT_CACHE_MAX_ENTRIES;

  const fresh = Object.entries(cache).filter(([, entry]) => isFresh(entry, now, ttlMs));
  const expired = Object.keys(cache).length - fresh.length;
  fresh.sort((a, b) => Date.parse(b[1].fetchedAt) - Date.parse(a[1].fetchedAt));
  const kept = fresh.slice(0, maxEntries);
  return { cache: Object.fromEntries(kept), removed: expired + (fresh.length - kept.length) };
}

async function readAll(): Promise<ContentCacheMap> {
  try {
    const rows = await getAllContentCacheRows();
    const map: ContentCacheMap = {};
    for (const row of rows) {
      map[row.id] = {
        url: row.url,
        title: row.title,
        text: row.text,
        markdown: row.markdown,
        fetchedAt: row.fetchedAt,
        hits: row.hits,
      };
    }
    return map;
  } catch (err) {
    console.warn('读取正文缓存失败:', err);
    return {};
  }
}

/** 取一条缓存（过期的直接当作未命中） */
export async function getCachedContent(
  url: string,
  now: Date = new Date(),
): Promise<CachedContent | null> {
  const cache = await readAll();
  const entry = cache[contentCacheKey(url)];
  if (!entry || !isFresh(entry, now)) return null;
  return entry;
}

/** 写入一条缓存（同一 url 只保留最新一份，并顺手维护过期与上限） */
export async function putCachedContent(
  entry: Omit<CachedContent, 'hits'> & { hits?: number },
  now: Date = new Date(),
): Promise<void> {
  const cache = await readAll();
  const key = contentCacheKey(entry.url);
  const merged: ContentCacheMap = {
    ...cache,
    [key]: {
      url: entry.url,
      title: entry.title.slice(0, 160),
      text: entry.text.slice(0, CACHED_TEXT_LIMIT),
      markdown: entry.markdown?.slice(0, CACHED_TEXT_LIMIT),
      fetchedAt: entry.fetchedAt,
      hits: (entry.hits ?? cache[key]?.hits ?? 0) + 1,
    },
  };
  const { cache: pruned, removed } = pruneContentCache(merged, now);

  const rows: ContentCacheRow[] = Object.entries(pruned).map(([id, value]) => ({
    id,
    url: value.url,
    title: value.title,
    text: value.text,
    markdown: value.markdown,
    fetchedAt: value.fetchedAt,
    hits: value.hits,
  }));
  await putContentCacheRows(rows);

  if (removed > 0) {
    const staleIds = Object.keys(cache).filter((id) => !(id in pruned));
    await deleteContentCacheRows(staleIds);
  }
}

/** 缓存概况（设置页展示"已缓存 N 页正文 · 可清除"） */
export async function summarizeContentCache(
  now: Date = new Date(),
): Promise<{ total: number; fresh: number; chars: number }> {
  const cache = await readAll();
  const entries = Object.values(cache);
  const fresh = entries.filter((e) => isFresh(e, now));
  return {
    total: entries.length,
    fresh: fresh.length,
    chars: fresh.reduce((sum, e) => sum + e.text.length, 0),
  };
}

/** 清空正文缓存（设置页"清除已抓取正文"） */
export async function clearContentCache(): Promise<number> {
  const cache = await readAll();
  const ids = Object.keys(cache);
  return deleteContentCacheRows(ids);
}
