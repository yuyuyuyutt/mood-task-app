// src/features/plan-generator/services/rag/hybridRetriever.ts
// 混合检索：启发式关键词排序 ⊕ 向量语义召回。
//
// 为什么用 **RRF（Reciprocal Rank Fusion）** 而不是加权求和：
//   启发式四维分是 0..1 的人工权重，余弦相似度是 -1..1 的几何量，**量纲不可比**；
//   加权要么反复调参、要么被某一侧主导，而且"为什么这条排前面"说不清。
//   RRF 只用**名次**：score = Σ w / (k + rank)，k 取 60（文献里的常用值）。
//   好处是：可解释（能说出每条来自哪一路、名次多少）、无需调参、对离群值不敏感。
//
// 本模块的两件事都支持降级：
//   - 语义侧任何失败（未开启/端点不通/维度不符）→ 返回 enabled=false + 原因，
//     调用方照常使用原来的启发式排序；
//   - 融合只负责**排序**与补齐 scoreDetail.semantic，不改写原有四维分。
import type { EmbeddingSettings, ResourceItem, SemanticSummary } from '../../types';
import {
  EMBEDDING_NAMESPACE_RESOURCE,
  buildResourceText,
  embedTexts,
  hashText,
  planEmbeddingWork,
  type EmbeddingRuntimeConfig,
} from './embedding';
import { SEMANTIC_TOP_K, type VectorStore } from './vectorStore';

/** RRF 平滑常数：越大越"平权"，60 是常用默认值 */
export const RRF_K = 60;

/** 单次最多嵌入多少条候选（候选本身已被截断到 MAX_TOTAL，这里再兜一层） */
export const MAX_EMBED_CANDIDATES = 24;

export interface RrfInput {
  keyword: string[];
  semantic: string[];
}

export interface RrfOptions {
  k?: number;
  weights?: { keyword?: number; semantic?: number };
}

export interface FusedItem {
  id: string;
  score: number;
  sources: Array<'keyword' | 'semantic'>;
}

/** RRF 融合：输入两路有序 id 列表，输出统一排序（同分按 id 稳定排序，保证可复现） */
export function fuseWithRRF(input: RrfInput, options: RrfOptions = {}): FusedItem[] {
  const k = options.k ?? RRF_K;
  const weights = {
    keyword: options.weights?.keyword ?? 1,
    semantic: options.weights?.semantic ?? 1,
  };

  const acc = new Map<string, { score: number; sources: Set<'keyword' | 'semantic'> }>();
  const add = (ids: string[], weight: number, source: 'keyword' | 'semantic') => {
    if (weight <= 0) return;
    ids.forEach((id, index) => {
      if (!id) return;
      const entry = acc.get(id) ?? { score: 0, sources: new Set<'keyword' | 'semantic'>() };
      entry.score += weight / (k + index + 1);
      entry.sources.add(source);
      acc.set(id, entry);
    });
  };

  add(input.keyword ?? [], weights.keyword, 'keyword');
  add(input.semantic ?? [], weights.semantic, 'semantic');

  return [...acc.entries()]
    .map(([id, value]) => ({
      id,
      score: Math.round(value.score * 1_000_000) / 1_000_000,
      sources: [...value.sources],
    }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

export interface SemanticRanking {
  id: string;
  /** 余弦相似度 */
  score: number;
}

/**
 * 用语义名次重排候选资源（纯函数）：
 * - 排序：RRF 融合"启发式顺序"与"语义顺序"；
 * - 维度：把余弦相似度写进 `scoreDetail.semantic`（第 5 维，仅记录不改权重）；
 * - 语义未命中任何一条时，原样返回（不做无意义的"融合"）。
 */
export function applySemanticRerank(
  items: ResourceItem[],
  ranked: SemanticRanking[],
): ResourceItem[] {
  if (ranked.length === 0 || items.length === 0) return items;

  const scoreById = new Map(ranked.map((r) => [r.id, r.score]));
  const fused = fuseWithRRF({
    keyword: items.map((i) => i.id),
    semantic: ranked.map((r) => r.id),
  });
  const order = new Map(fused.map((f, index) => [f.id, index]));

  return [...items]
    .sort(
      (a, b) =>
        (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    )
    .map((item) => {
      const semantic = scoreById.get(item.id);
      if (semantic === undefined || !item.scoreDetail) return item;
      return {
        ...item,
        scoreDetail: { ...item.scoreDetail, semantic: Math.round(semantic * 1000) / 1000 },
      };
    });
}

export interface RagRuntime {
  store: VectorStore;
  config: EmbeddingRuntimeConfig;
}

/**
 * 组装一次检索所需的运行时（端点沿用「AI 增强」里配置的本地模型地址）。
 * 组件里只用这一处入口，避免"两个 Ollama 地址"的长期隐患。
 */
export function buildRagRuntime(
  llmConfig: { baseUrl: string },
  settings: Pick<EmbeddingSettings, 'model' | 'timeoutMs'>,
  store: VectorStore,
): RagRuntime {
  return {
    store,
    config: {
      baseUrl: llmConfig.baseUrl,
      model: settings.model,
      timeoutMs: settings.timeoutMs,
    },
  };
}

export interface SemanticRun {
  summary: SemanticSummary;
  /** 语义序（按余弦降序） */
  ranked: SemanticRanking[];
}

/** 把一次语义检索的结果压成一句人话（给 UI 的 warning/notice 用） */
export function summarizeSemantic(summary: SemanticSummary): string {
  if (!summary.enabled) return '';
  const parts = [`语义召回 ${summary.matched} 条`];
  if (summary.embedded > 0) parts.push(`新索引 ${summary.embedded} 条`);
  if (summary.reused > 0) parts.push(`复用缓存 ${summary.reused} 条`);
  if (summary.model) parts.push(`模型 ${summary.model}`);
  return parts.join(' · ');
}

export interface SemanticRetrievalParams {
  items: ResourceItem[];
  /** 已由 buildQueryText 生成的检索 query */
  query: string;
  runtime: RagRuntime;
  signal?: AbortSignal;
  topK?: number;
}

/**
 * 跑一次语义检索（在已有候选资源上做向量召回）。
 * **永不抛出**：任何异常都转成 `enabled:false + degradedReason`，由调用方决定如何提示。
 */
export async function runSemanticRetrieval(
  params: SemanticRetrievalParams,
): Promise<SemanticRun> {
  const { items, query, runtime, signal, topK = SEMANTIC_TOP_K } = params;
  const { store, config } = runtime;
  const base: SemanticSummary = {
    enabled: false,
    model: config.model || null,
    embedded: 0,
    reused: 0,
    matched: 0,
  };

  if (!config.model) {
    return { summary: { ...base, degradedReason: '未配置 embedding 模型' }, ranked: [] };
  }
  if (items.length === 0) {
    return { summary: { ...base, degradedReason: '没有可嵌入的候选资源' }, ranked: [] };
  }

  const candidates = items.slice(0, MAX_EMBED_CANDIDATES);
  const textById = new Map(
    candidates.map((item) => [item.id, buildResourceText(item)] as const),
  );
  const refs = candidates.map((item) => ({
    refId: item.id,
    hash: hashText(textById.get(item.id) ?? ''),
  }));

  try {
    const existing = await store.hashes(EMBEDDING_NAMESPACE_RESOURCE, config.model);
    const { toEmbed, reused } = planEmbeddingWork(refs, existing);
    const hashById = new Map(refs.map((r) => [r.refId, r.hash] as const));

    let embedded = 0;
    if (toEmbed.length > 0) {
      const vectors = await embedTexts(
        toEmbed.map((id) => textById.get(id) ?? ''),
        config,
        { signal },
      );
      embedded = await store.upsert(
        EMBEDDING_NAMESPACE_RESOURCE,
        toEmbed.map((id, index) => ({
          namespace: EMBEDDING_NAMESPACE_RESOURCE,
          refId: id,
          model: config.model,
          contentHash: hashById.get(id) ?? '',
          vector: vectors[index],
        })),
      );
    }

    const [queryVector] = await embedTexts([query], config, { signal });
    const matches = await store.search(
      EMBEDDING_NAMESPACE_RESOURCE,
      queryVector,
      topK,
      undefined,
      config.model,
    );
    const ranked = matches.map((m) => ({ id: m.refId, score: m.score }));
    return {
      summary: { ...base, enabled: true, embedded, reused, matched: ranked.length },
      ranked,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { summary: { ...base, degradedReason: msg }, ranked: [] };
  }
}
