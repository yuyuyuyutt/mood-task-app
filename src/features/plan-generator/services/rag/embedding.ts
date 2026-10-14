// src/features/plan-generator/services/rag/embedding.ts
// 本地 embedding 层：文本 → 向量（走 Ollama，数据不出本机）。
//
// 三条纪律：
//   1) **内容寻址**：每条文本先算哈希，哈希没变就不重算（planEmbeddingWork 决定要重算哪些）；
//      embedding 是本地模型里最贵的一步，缓存命中率直接决定这个功能"能不能日常用"。
//   2) **接口兼容**：优先用批量接口 `/api/embed`，遇到"端点/格式不支持"才退回逐条 `/api/embeddings`；
//      超时与网络错误**不重试**（换端点也一样连不上，白等一轮）。
//   3) **失败即抛**：本层不做降级决策，由调用方（hybridRetriever）统一降级为纯关键词检索。
import type { ResourceItem, SearchKeyword } from '../../types';

/** 向量索引用途命名空间（未来可扩展 'memory' 等） */
export const EMBEDDING_NAMESPACE_RESOURCE = 'resource';

/** UI 里推荐的本地 embedding 模型（体积小、中文可用的几个） */
export const SUGGESTED_EMBEDDING_MODELS = [
  'nomic-embed-text',
  'bge-m3',
  'mxbai-embed-large',
  'all-minilm',
];

export interface EmbeddingRuntimeConfig {
  /** 本地模型端点（与 LLM 共用一个 baseUrl） */
  baseUrl: string;
  model: string;
  timeoutMs: number;
  /** Ollama 模型驻留时长，默认 30s（用完即卸，不常驻占内存） */
  keepAlive?: string;
}

/** 稳定短哈希（djb2，base36）：与 resourceService.hashString 同算法，用作内容指纹 */
export function hashText(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/**
 * 一条资源用于 embedding 的规范化文本。
 * 只包含**元数据**（标题/类型/作者/难度/摘要），不含网页正文 ——
 * 与项目"不保存正文"的隐私口径一致，也让哈希稳定可缓存。
 */
export function buildResourceText(item: ResourceItem): string {
  const parts = [
    item.title,
    `类型：${item.type}`,
    item.author ? `作者：${item.author}` : '',
    item.difficulty && item.difficulty !== 'unknown' ? `难度：${item.difficulty}` : '',
    item.snippet ? item.snippet.replace(/\s+/g, ' ').slice(0, 120) : '',
  ];
  return parts.filter(Boolean).join(' | ').slice(0, 400);
}

/** 检索 query 的文本：目标 + 高优先级关键词 */
export function buildQueryText(goal: string, keywords: SearchKeyword[], limit = 4): string {
  const kws = [...keywords]
    .sort((a, b) => a.priority - b.priority)
    .slice(0, limit)
    .map((k) => k.keyword)
    .join(' ');
  return `${goal} ${kws}`.replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** L2 归一化（零向量原样返回，避免除零得到 NaN） */
export function normalizeVector(vector: number[]): number[] {
  let sum = 0;
  for (const v of vector) sum += v * v;
  const norm = Math.sqrt(sum);
  if (!Number.isFinite(norm) || norm <= 1e-8) return [...vector];
  return vector.map((v) => v / norm);
}

/** 余弦相似度：两侧都归一化后退化为点积；维度不一致视为不相关（返回 0） */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

export interface EmbeddingRef {
  refId: string;
  /** buildResourceText 的哈希 */
  hash: string;
}

export interface EmbeddingWork {
  /** 需要重算 embedding 的 refId（新增或内容已变） */
  toEmbed: string[];
  /** 命中缓存、直接复用旧向量的条数 */
  reused: number;
}

/**
 * 决定"哪些内容需要重新计算 embedding"——纯函数，便于单测。
 * 只有 refId 存在且哈希一致才算复用；内容变了必须重算，否则检索会命中过时的向量。
 */
export function planEmbeddingWork(
  refs: EmbeddingRef[],
  existing: Map<string, string>,
): EmbeddingWork {
  const toEmbed: string[] = [];
  let reused = 0;
  for (const ref of refs) {
    if (existing.get(ref.refId) === ref.hash) {
      reused += 1;
    } else {
      toEmbed.push(ref.refId);
    }
  }
  return { toEmbed, reused };
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'number');
}

/**
 * 是否值得退回到逐条的老接口 `/api/embeddings`。
 * 只有"端点不存在 / 不接受这种输入"才退；超时、连不上、5xx 一律直接降级——
 * 否则每个文本都要再白等一次超时。
 */
export function shouldFallbackToLegacy(message: string): boolean {
  return /HTTP\s*40[04]|not\s*found|unknown\s*(endpoint|route)|不符合预期/i.test(message);
}

async function postJson(
  url: string,
  body: unknown,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}${text ? `：${text.slice(0, 160)}` : ''}`);
    }
    return (await res.json()) as unknown;
  } catch (err) {
    if (signal?.aborted) throw new Error('已取消');
    const msg = err instanceof Error ? err.message : String(err);
    if (/abort/i.test(msg)) throw new Error(`embedding 请求超时（${timeoutMs}ms）`);
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** 老版本 Ollama 的逐条接口（/api/embeddings）：串行调用，避免把本地模型打满 */
async function embedTextsLegacy(
  texts: string[],
  config: EmbeddingRuntimeConfig,
  signal?: AbortSignal,
): Promise<number[][]> {
  const out: number[][] = [];
  for (const text of texts) {
    const data = await postJson(
      `${trimSlash(config.baseUrl)}/api/embeddings`,
      { model: config.model, prompt: text, keep_alive: config.keepAlive ?? '30s' },
      config.timeoutMs,
      signal,
    );
    const embedding = (data as { embedding?: unknown }).embedding;
    if (!isNumberArray(embedding)) {
      throw new Error('embeddings 接口返回结构不符合预期（缺少 embedding 数组）');
    }
    out.push(normalizeVector(embedding));
  }
  return out;
}

/**
 * 批量把文本转成向量（返回顺序与入参一致，向量已归一化）。
 * 失败一律抛错，由上层决定是否降级为纯关键词检索。
 */
export async function embedTexts(
  texts: string[],
  config: EmbeddingRuntimeConfig,
  options: { signal?: AbortSignal } = {},
): Promise<number[][]> {
  const clean = texts.map((t) => t.replace(/\s+/g, ' ').trim());
  if (clean.length === 0) return [];
  if (!config.model) throw new Error('未配置 embedding 模型');
  if (!config.baseUrl) throw new Error('未配置本地模型端点');
  if (clean.some((t) => t.length === 0)) throw new Error('存在空的待嵌入文本');

  try {
    const data = await postJson(
      `${trimSlash(config.baseUrl)}/api/embed`,
      { model: config.model, input: clean, keep_alive: config.keepAlive ?? '30s' },
      config.timeoutMs,
      options.signal,
    );
    const embeddings = (data as { embeddings?: unknown }).embeddings;
    if (
      !Array.isArray(embeddings) ||
      embeddings.length !== clean.length ||
      !embeddings.every(isNumberArray)
    ) {
      throw new Error('embed 接口返回结构不符合预期（缺少 embeddings 数组）');
    }
    return (embeddings as number[][]).map(normalizeVector);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!shouldFallbackToLegacy(msg)) throw err;
    return embedTextsLegacy(clean, config, options.signal);
  }
}

export interface EmbeddingProbe {
  ok: boolean;
  /** 向量维度（换了模型维度会变，用户能立刻看出来） */
  dim: number;
  error?: string;
}

/** 探测 embedding 是否可用（设置页"测试"按钮）：跑一次真实的最小请求 */
export async function probeEmbedding(
  baseUrl: string,
  model: string,
  timeoutMs = 15_000,
): Promise<EmbeddingProbe> {
  try {
    const [vector] = await embedTexts(['语义检索连通性测试'], { baseUrl, model, timeoutMs });
    return { ok: true, dim: vector.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const hint = msg.includes('超时')
      ? '请确认 Ollama 已启动（ollama serve）'
      : `请确认已安装该模型（ollama pull ${model}）；若控制台提示 CORS，请设置 OLLAMA_ORIGINS="*" 后重启 Ollama`;
    return { ok: false, dim: 0, error: `${msg}。${hint}` };
  }
}
