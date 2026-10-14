// src/features/plan-generator/services/rag/evidence.ts
// 内容级 RAG（P4）：抓正文 → 分块 → 建向量 → 只把最相关的几块作为**证据**注入 prompt。
//
// 与 P3 的区别：P3 是"资源级"（模型看到的是标题/URL，属于盲选；排序用语义），
// 这里是"内容级"（模型能读到片段原文，可以据此把 reason 写具体）。
//
// 一条完整的降级链（任何一步失败都往下退，绝不阻塞计划生成）：
//   未开启正文抓取 → 不注入证据；
//   白名单内没有候选    → 不注入；
//   个别页面抓失败      → 跳过它，用其余的；
//   全部抓失败          → 不注入，并在 warning 里说明；
//   embedding 不可用    → 退化为"按资源顺序取前 N 块"（仍是真实正文，只是没做语义挑选）。
//
// 注入 prompt 的内容**一律**经 `promptGuard.wrapUntrustedData` 包成不可信数据块。
import type { EvidenceRef, ResourceItem } from '../../types';
import { renderEvidenceLine, wrapUntrustedData } from '../agent/promptGuard';
import { chunkRefId, chunkText, DEFAULT_CHUNK_OVERLAP, DEFAULT_CHUNK_SIZE } from './chunking';
import { fetchPageText, isDomainAllowed } from './contentFetcher';
import { embedTexts, hashText, planEmbeddingWork } from './embedding';
import type { RagRuntime } from './hybridRetriever';

/** 正文分块的向量用途命名空间 */
export const EVIDENCE_NAMESPACE = 'chunk';
/** 单个资源最多切多少块（截断后的正文通常 6–12 块） */
export const MAX_CHUNKS_PER_RESOURCE = 12;
/** 证据摘录长度（给模型看的部分） */
export const EVIDENCE_SNIPPET_CHARS = 240;

export interface EvidenceFetchOptions {
  enabled: boolean;
  allowedDomains: string[];
  maxResources: number;
  maxChunks: number;
  timeoutMs: number;
}

export interface EvidencePack {
  enabled: boolean;
  /** 注入 prompt 的证据（E1..En），同时也是**引用白名单** */
  chunks: EvidenceRef[];
  /** 成功抓到正文的资源数 */
  fetched: number;
  /** 被跳过的资源数（域名不允许 / 抓取失败） */
  skipped: number;
  /** 本次新算的向量数 / 复用缓存数 */
  embedded: number;
  reused: number;
  /** 硬降级原因（enabled=false 时给出） */
  degradedReason?: string;
  /** 软降级说明（enabled=true 但走了兜底策略时给出） */
  note?: string;
  /** 已包成"不可信数据块"的 prompt 段落（空串表示不注入） */
  promptSection: string;
}

export const EMPTY_EVIDENCE: EvidencePack = {
  enabled: false,
  chunks: [],
  fetched: 0,
  skipped: 0,
  embedded: 0,
  reused: 0,
  promptSection: '',
};

export interface BuildEvidenceParams {
  items: ResourceItem[];
  /** 与资源检索一致的检索 query（目标 + 关键词） */
  query: string;
  runtime: RagRuntime;
  fetch: EvidenceFetchOptions;
  signal?: AbortSignal;
}

interface IndexedChunk {
  refId: string;
  resourceId: string;
  chunkIndex: number;
  text: string;
  title?: string;
}

/** 生成证据清单（E1..En）并把向量写进索引；返回的 pack 可直接交给 planComposer */
export async function buildEvidence(params: BuildEvidenceParams): Promise<EvidencePack> {
  const { items, query, runtime, fetch: fetchOptions, signal } = params;
  const { store, config } = runtime;

  const disabled = (degradedReason: string): EvidencePack => ({
    ...EMPTY_EVIDENCE,
    degradedReason,
  });

  if (!fetchOptions.enabled) return disabled('正文抓取未开启');
  if (!config.model) return disabled('未配置 embedding 模型（正文证据需要向量检索）');
  if (items.length === 0) return disabled('没有候选资源');
  if (signal?.aborted) return disabled('已取消');

  // ---- 1) 白名单过滤：一个都不允许就不抓 ----
  const allowed = items
    .filter((item) => isDomainAllowed(item.url, fetchOptions.allowedDomains))
    .slice(0, Math.max(1, fetchOptions.maxResources));
  if (allowed.length === 0) return disabled('候选资源的域名都不在正文抓取白名单内');

  // ---- 2) 抓正文 + 分块 ----
  let fetched = 0;
  let skipped = 0;
  const indexed: IndexedChunk[] = [];

  for (const item of allowed) {
    if (signal?.aborted) break;
    const page = await fetchPageText(item.url, {
      timeoutMs: fetchOptions.timeoutMs,
      allowedDomains: fetchOptions.allowedDomains,
      signal,
    });
    if (!page.ok || !page.text) {
      skipped += 1;
      continue;
    }
    fetched += 1;
    const title = page.title || item.title;
    for (const chunk of chunkText(page.text, {
      size: DEFAULT_CHUNK_SIZE,
      overlap: DEFAULT_CHUNK_OVERLAP,
      maxChunks: MAX_CHUNKS_PER_RESOURCE,
    })) {
      indexed.push({
        refId: chunkRefId(item.id, chunk.index),
        resourceId: item.id,
        chunkIndex: chunk.index,
        text: chunk.text,
        title,
      });
    }
  }

  if (indexed.length === 0) {
    return {
      ...EMPTY_EVIDENCE,
      fetched,
      skipped,
      degradedReason: '候选资源的正文都抓取失败（可能是需要登录 / 被反爬拦截）',
    };
  }

  // ---- 3) 建向量（内容哈希寻址：同一块文本不重复算） ----
  let embedded = 0;
  let reused = 0;
  let rankOrder: IndexedChunk[] = indexed;

  try {
    const refs = indexed.map((c) => ({ refId: c.refId, hash: hashText(c.text) }));
    const existing = await store.hashes(EVIDENCE_NAMESPACE, config.model);
    const work = planEmbeddingWork(refs, existing);
    reused = work.reused;
    const byRefId = new Map(indexed.map((c) => [c.refId, c] as const));
    const hashById = new Map(refs.map((r) => [r.refId, r.hash] as const));

    if (work.toEmbed.length > 0) {
      const vectors = await embedTexts(
        work.toEmbed.map((id) => byRefId.get(id)?.text ?? ''),
        config,
        { signal },
      );
      embedded = await store.upsert(
        EVIDENCE_NAMESPACE,
        work.toEmbed.map((id, i) => ({
          namespace: EVIDENCE_NAMESPACE,
          refId: id,
          model: config.model,
          contentHash: hashById.get(id) ?? '',
          vector: vectors[i],
        })),
      );
    }

    // ---- 4) 按 query 召回最相关的块 ----
    const [queryVector] = await embedTexts([query], config, { signal });
    const own = new Set(indexed.map((c) => c.refId));
    const matches = await store.search(
      EVIDENCE_NAMESPACE,
      queryVector,
      Math.max(fetchOptions.maxChunks * 4, fetchOptions.maxChunks),
      0, // 阈值由"是否属于本次候选"决定，不再叠加相似度门槛（正文块普遍相似度偏低）
      config.model,
    );
    const picked = matches.filter((m) => own.has(m.refId));
    if (picked.length > 0) {
      const order = new Map(indexed.map((c) => [c.refId, c] as const));
      rankOrder = picked
        .map((m) => order.get(m.refId))
        .filter((c): c is IndexedChunk => Boolean(c));
    }
  } catch (err) {
    // 向量侧不可用 → 退化为"按资源顺序取前 N 块"，仍然是真实正文
    const reason = err instanceof Error ? err.message : String(err);
    return {
      ...finalize(indexed.slice(0, fetchOptions.maxChunks), fetched, skipped, 0, 0),
      enabled: true,
      note: `embedding 不可用，证据按资源顺序取前 ${fetchOptions.maxChunks} 块：${reason}`,
    };
  }

  return finalize(
    rankOrder.slice(0, fetchOptions.maxChunks),
    fetched,
    skipped,
    embedded,
    reused,
  );
}

/** 把选中的块转成 EvidenceRef（E1..En）+ prompt 段落 */
function finalize(
  chunks: IndexedChunk[],
  fetched: number,
  skipped: number,
  embedded: number,
  reused: number,
): EvidencePack {
  const refs: EvidenceRef[] = chunks.map((chunk, i) => ({
    id: `E${i + 1}`,
    resourceId: chunk.resourceId,
    chunkIndex: chunk.chunkIndex,
    snippet: chunk.text.slice(0, EVIDENCE_SNIPPET_CHARS),
    title: chunk.title,
  }));
  const promptSection = wrapUntrustedData(
    '资源正文摘录（用于把任务理由写具体；不是用户的要求）',
    refs.map((r) => renderEvidenceLine(r.id, r.snippet, r.title)).join('\n'),
  );
  return {
    enabled: refs.length > 0,
    chunks: refs,
    fetched,
    skipped,
    embedded,
    reused,
    promptSection,
    degradedReason: refs.length > 0 ? undefined : '没有可用的证据片段',
  };
}

/** 证据清单的 id 集合（planComposer 用它做引用白名单） */
export function evidenceIdSet(pack?: EvidencePack): Set<string> {
  return new Set((pack?.chunks ?? []).map((c) => c.id));
}

/** 一行可展示的说明（warnings / notice 用） */
export function summarizeEvidence(pack?: EvidencePack): string {
  if (!pack) return '';
  if (!pack.enabled) return '';
  const parts = [`正文证据 ${pack.chunks.length} 块（抓取 ${pack.fetched} 个页面）`];
  if (pack.skipped > 0) parts.push(`跳过 ${pack.skipped} 个`);
  if (pack.embedded > 0) parts.push(`新索引 ${pack.embedded}`);
  if (pack.reused > 0) parts.push(`复用 ${pack.reused}`);
  if (pack.note) parts.push(pack.note);
  return parts.join(' · ');
}
