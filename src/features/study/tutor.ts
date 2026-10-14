// src/features/study/tutor.ts
// 学习辅导员（**默认禁止无依据回答**）。
//
// 这是工作区里唯一的 Agent 能力，也是决定"用户会不会真的用它学习"的地方。三条纪律：
//
//   1) **先检索再回答**：问题先在"当前资源的正文"里做向量检索，只有检索到足够相关的片段才回答；
//      检索不到就直说"这条资源里没有"，**根本不调用模型**（决定 #3）。
//      为什么要这么硬：本地 7B 模型在没有依据时几乎一定会编，而学习场景里"编一个错的解释"
//      比"什么都没说"有害得多。
//   2) **引用可追溯**：模型只能引用本次注入的片段编号（E1..En），编造的编号一律丢弃并计数，
//      与项目既有的"引用级防幻觉"是同一条纪律。
//   3) **正文当不可信数据**：片段经 `promptGuard` 包裹并在 system 里声明其不构成指令 ——
//      网页正文里写"忽略之前的指示"这类注入不会变成指令。
//
// 复用而非重写：分块 `chunkText`、向量 `VectorStore`（独立命名空间 `study:resource`）、
// 传输 `streamChat`（流式，首字延迟决定手感）、调度 `llmTasks`（串行/去重/取消）、
// 轨迹 `TraceRecorder`（每一步都可回看，包括"为什么拒绝回答"）。
import {
  chunkRefId,
  chunkText,
} from '../plan-generator/services/rag/chunking';
import {
  embedTexts,
  hashText,
  type EmbeddingRuntimeConfig,
} from '../plan-generator/services/rag/embedding';
import type { VectorStore } from '../plan-generator/services/rag/vectorStore';
import {
  sanitizeExternalText,
  wrapUntrustedData,
  UNTRUSTED_SYSTEM_RULE,
} from '../plan-generator/services/agent/promptGuard';
import { TraceRecorder } from '../plan-generator/services/agent/trace';
import { streamChat, type ChatMessage } from '../plan-generator/services/llm/chatClient';
import { llmTasks } from '../plan-generator/services/llmTaskManager';
import type { LLMConfig } from '../plan-generator/services/llmClient';
import type { TutorMessage } from './types';

/** 学习语料的独立命名空间：与资源排序（`resource`）、生成期证据（`chunk`）互不干扰 */
export const TUTOR_NAMESPACE = 'study:resource';
/** 检索候选条数 */
export const TUTOR_TOP_K = 6;
/** 相关性下限：低于它的片段不构成"依据"（比资源级的 0.2 更严，因为要靠它支撑一段回答） */
export const MIN_TUTOR_SCORE = 0.35;
/** 单条资源最多索引多少块 */
export const MAX_TUTOR_CHUNKS = 24;
/** 单块注入 prompt 的字数上限（防 prompt 失控） */
export const TUTOR_CHUNK_CHARS = 600;

export interface StudyResourceRef {
  id: string;
  title: string;
  url: string;
}

export interface TutorChunk {
  /** 向量库里的 refId：`${resourceId}#${index}` */
  id: string;
  index: number;
  text: string;
  /** 内容哈希：用于增量嵌入（正文没变就不重复请求） */
  hash: string;
}

/** 建语料块（纯函数） */
export function buildTutorChunks(
  text: string,
  resourceId: string,
  maxChunks: number = MAX_TUTOR_CHUNKS,
): TutorChunk[] {
  return chunkText(text, { maxChunks }).map((chunk) => ({
    id: chunkRefId(resourceId, chunk.index),
    index: chunk.index,
    text: chunk.text,
    hash: hashText(chunk.text),
  }));
}

/** 从模型回答里抽取引用编号，并按白名单过滤（纯函数） */
export function parseTutorCitations(
  answer: string,
  allowed: string[],
): { citations: string[]; dropped: number } {
  const found = [...answer.matchAll(/\[(E\d+)\]/g)].map((m) => m[1]);
  const unique = Array.from(new Set(found));
  const allowSet = new Set(allowed);
  const citations = unique.filter((id) => allowSet.has(id));
  return { citations, dropped: unique.length - citations.length };
}

const TUTOR_SYSTEM = [
  '你是学习辅导员。你只能根据用户消息里给出的【资源片段】回答，不允许使用片段之外的知识。',
  '',
  '硬性要求：',
  '1) 片段里没有讲到的内容，直接回答"这条资源里没有讲到这里"，不要补充你自己的想法、也不要猜；',
  '2) 每个结论后面标注来源编号（如 [E1]），只能引用片段里出现过的编号；一处结论对应一处编号；',
  '3) 中文回答，先给结论再展开，不要复述整段原文，不要输出 Markdown 代码块；',
  '4) 用户问"怎么做"时，给出片段里提到的具体步骤或例子；片段里没有步骤就说明没有；',
  '5) 回答控制在 200 字以内；如果需要更多，先给最关键的 3 点。',
].join('\n');

export interface BuildTutorMessagesParams {
  question: string;
  resource: StudyResourceRef;
  /** 本次真正注入的片段（顺序即 E1..En 的编号） */
  chunks: TutorChunk[];
  history?: TutorMessage[];
}

export function buildTutorMessages(params: BuildTutorMessagesParams): ChatMessage[] {
  const { question, resource, chunks, history = [] } = params;
  const body = chunks
    .map((chunk, index) => `[E${index + 1}] ${sanitizeExternalText(chunk.text, TUTOR_CHUNK_CHARS)}`)
    .join('\n\n');
  const contextBlock = wrapUntrustedData(`资源：${resource.title}`, body);

  // 只带最近 4 条，避免历史把上下文挤爆（长对话的价值主要在最近几轮）
  const recent: ChatMessage[] = history
    .slice(-4)
    .map((message) => ({ role: message.role, content: message.content }));

  return [
    { role: 'system', content: `${TUTOR_SYSTEM}\n\n${UNTRUSTED_SYSTEM_RULE}` },
    ...recent,
    {
      role: 'user',
      content: [
        `用户问题：${question}`,
        '',
        `可用的资源片段（编号只能引用这些）：`,
        contextBlock,
      ].join('\n'),
    },
  ];
}

export interface TutorCitation {
  id: string;
  /** 被引用的片段原文（UI 里展开可核对） */
  text: string;
}

export interface TutorAnswer {
  status: 'answered' | 'no_evidence' | 'failed';
  answer: string;
  citations: TutorCitation[];
  /** 模型编造的、被丢弃的引用数 */
  droppedCitations: number;
  /** no_evidence / failed 时的原因（直接展示给用户，含下一步动作） */
  reason?: string;
  /** 本次召回到的片段数 */
  matchedChunks: number;
  traceId: string;
  streamed: boolean;
}

/** 一次检索所需的运行时（与计划生成器共用同一套组装方式） */
export interface TutorCorpus {
  store: VectorStore;
  config: EmbeddingRuntimeConfig;
}

export interface TutorDeps {
  embed?: typeof embedTexts;
  chatStream?: typeof streamChat;
}

export interface AskTutorParams {
  question: string;
  resource: StudyResourceRef;
  /** 当前资源的正文（来自阅读模式；为空则拒绝作答） */
  text: string;
  /** 对话模型配置 */
  config: LLMConfig;
  /** embedding 运行时 */
  corpus: TutorCorpus;
  history?: TutorMessage[];
  signal?: AbortSignal;
  /** 流式增量回调（UI 直接追加） */
  onDelta?: (chunk: string) => void;
  deps?: TutorDeps;
  now?: Date;
}

/** 增量同步语料：正文没变就不重复调 embedding（与证据流水线一致的做法） */
async function syncTutorCorpus(params: {
  chunks: TutorChunk[];
  corpus: TutorCorpus;
  embed: typeof embedTexts;
  signal?: AbortSignal;
}): Promise<{ embedded: number; reused: number }> {
  const { chunks, corpus, embed, signal } = params;
  const existing = await corpus.store.hashes(TUTOR_NAMESPACE, corpus.config.model);
  const pending = chunks.filter((chunk) => existing.get(chunk.id) !== chunk.hash);
  if (pending.length === 0) return { embedded: 0, reused: chunks.length };

  const vectors = await embed(
    pending.map((chunk) => chunk.text),
    corpus.config,
    { signal },
  );
  await corpus.store.upsert(
    TUTOR_NAMESPACE,
    pending.map((chunk, index) => ({
      namespace: TUTOR_NAMESPACE,
      refId: chunk.id,
      model: corpus.config.model,
      contentHash: chunk.hash,
      vector: vectors[index] ?? [],
    })),
  );
  return { embedded: pending.length, reused: chunks.length - pending.length };
}

/**
 * 提问。**永不抛错**：没有依据、检索不可用、模型失败都会返回带 `reason` 的结构化结果，
 * 由界面给出下一步动作 —— 宁可说"我答不了"，也不要给一个编出来的解释。
 */
export async function askTutor(params: AskTutorParams): Promise<TutorAnswer> {
  const { question, resource, text, config, corpus, history = [], signal, onDelta } = params;
  const embed = params.deps?.embed ?? embedTexts;
  const chat = params.deps?.chatStream ?? streamChat;
  const trace = new TraceRecorder('study', question).setLevel('agent').setModel(config.model ?? null);

  const refuse = (reason: string, status: 'no_evidence' | 'failed' = 'no_evidence'): TutorAnswer => {
    trace.fallback('tutor', reason);
    const finished = trace.end();
    return {
      status,
      answer: '',
      citations: [],
      droppedCitations: 0,
      reason,
      matchedChunks: 0,
      traceId: finished.id,
      streamed: false,
    };
  };

  // 1) 前置闸门：没有正文 / 没开模型，一律不回答（决定 #3）
  if (!text.trim()) {
    return refuse('这条资源还没有正文可查。先点「读取正文」（需要域名在白名单里），或直接在浏览器里看。');
  }
  if (!config.enabled || !config.model) {
    return refuse('未开启本地模型（设置页 → AI 增强）。没有模型就无法做基于依据的辅导。', 'failed');
  }

  // 2) 建索引 + 检索依据
  const chunks = buildTutorChunks(text, resource.id);
  trace.step('tutor:corpus', 'retrieval', 0, true, `${chunks.length} 个片段`);

  let matches: Array<{ refId: string; score: number }> = [];
  try {
    matches = await trace.measure('tutor:search', 'retrieval', async () => {
      const sync = await syncTutorCorpus({ chunks, corpus, embed, signal });
      trace.step(
        'tutor:embed',
        'retrieval',
        0,
        true,
        `新嵌入 ${sync.embedded} 块 / 复用 ${sync.reused} 块`,
      );
      const [questionVector] = await embed([question], corpus.config, { signal });
      return corpus.store.search(
        TUTOR_NAMESPACE,
        questionVector ?? [],
        TUTOR_TOP_K,
        MIN_TUTOR_SCORE,
        corpus.config.model,
      );
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return refuse(`语义检索不可用（${msg}）。无法确认依据，因此不回答。`, 'failed');
  }

  // 只保留"当前正文里的块"：向量库里可能还留着这条资源旧版本的块
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const matched = matches
    .map((match) => ({ chunk: byId.get(match.refId), score: match.score }))
    .filter((item): item is { chunk: TutorChunk; score: number } => Boolean(item.chunk));

  if (matched.length === 0) {
    return refuse(
      '这条资源里没有能支撑回答的内容（检索不到相关片段）。可以换个更贴近正文的问法，或直接在浏览器里看。',
    );
  }

  // 3) 带着依据问模型（流式）
  const injected = matched.map((item) => item.chunk);
  const allowed = injected.map((_, index) => `E${index + 1}`);
  trace.step(
    'tutor:prompt',
    'agent',
    0,
    true,
    `注入 ${injected.length} 个片段（${allowed.join('、')}）`,
  );

  const messages = buildTutorMessages({ question, resource, chunks: injected, history });
  let answerText = '';
  try {
    const result = await trace.measure('chat:tutor', 'llm', () =>
      llmTasks.run({
        kind: 'study',
        // 同一资源的连续提问串行执行，避免本地模型被并发请求拖垮
        key: `study:${resource.id}`,
        timeoutMs: config.timeoutMs ?? 120_000,
        signal,
        run: (taskSignal) => chat(messages, config, { signal: taskSignal, onDelta }),
      }),
    );
    answerText = result.text.trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return refuse(`模型调用失败：${msg}`, 'failed');
  }

  if (!answerText) {
    return refuse('模型没有返回内容，可以再试一次。', 'failed');
  }

  // 4) 引用白名单：编造的编号一律丢弃并计数
  const { citations, dropped } = parseTutorCitations(answerText, allowed);
  trace.step('guard:citations', 'guard', 0, dropped === 0, `引用 ${citations.length} 处，丢弃 ${dropped} 处`);
  const finished = trace.end();

  return {
    status: 'answered',
    answer: answerText,
    citations: citations.map((id) => ({
      id,
      text: injected[Number(id.slice(1)) - 1]?.text ?? '',
    })),
    droppedCitations: dropped,
    matchedChunks: injected.length,
    traceId: finished.id,
    streamed: true,
  };
}
