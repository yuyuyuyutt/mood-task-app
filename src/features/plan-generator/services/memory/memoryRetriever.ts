// src/features/plan-generator/services/memory/memoryRetriever.ts
// 记忆**召回**（纯函数，无 IO）。
//
// 本版本不引入向量：本地场景下记忆条目量级是"几十条"，结构化 + 词面匹配已经够用，
// 而且打分四项**每项都可解释**，出问题能直接定位是哪一项失准。
// 向量召回是 P3 的事（复用同一套 MemoryNote，只替换 lexical 维度的实现）。
import type { GoalCategory, MemoryHit, MemoryNote } from '../../types';
import { DEFAULT_ARCHIVE_THRESHOLD } from './memoryWriter';

const WEIGHTS = {
  category: 0.3,
  lexical: 0.3,
  confidence: 0.25,
  recency: 0.15,
};

/** 默认最低召回分：低于它的记忆不进 prompt（宁缺毋滥，避免污染上下文） */
export const MIN_RECALL_SCORE = 0.2;
/**
 * 相关性闸门：词面重合的最低要求。
 * 没有这道闸门，"新且自信"的记忆（recency + confidence 就能贡献 0.4 分）会无条件被召回，
 * 结果是把无关目标的历史塞进 prompt —— 这是记忆系统最常见的退化方式。
 */
export const MIN_LEXICAL_SCORE = 0.1;
/** 召回条数上限 */
export const DEFAULT_RECALL_LIMIT = 2;

/** 中文按字与 2-gram、英文数字按词切分，用于词面重叠计算（不依赖分词库） */
export function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  const lower = text.toLowerCase();
  const runs = lower.match(/[\u4e00-\u9fa5]+|[a-z0-9]+/g) ?? [];
  for (const run of runs) {
    if (/^[a-z0-9]+$/.test(run)) {
      if (run.length >= 2) tokens.add(run);
      continue;
    }
    for (let i = 0; i < run.length; i++) {
      tokens.add(run[i]);
      if (i + 1 < run.length) tokens.add(run.slice(i, i + 2));
    }
  }
  return tokens;
}

/** Jaccard 相似度：交集 / 并集 */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const token of a) if (b.has(token)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** 时间衰减：30 天内的记忆接近满分，之后按 60 天半衰期下降 */
export function recencyScore(lastUsedAt: string, now: Date): number {
  const ts = Date.parse(lastUsedAt);
  if (!Number.isFinite(ts)) return 0;
  const ageDays = Math.max(0, (now.getTime() - ts) / (24 * 3600 * 1000));
  if (ageDays <= 30) return 1;
  return Math.pow(0.5, (ageDays - 30) / 60);
}

export interface RecallParams {
  goal: string;
  category?: GoalCategory;
  kind?: MemoryNote['kind'];
  /** 返回条数上限 */
  limit?: number;
  /** 最低分 */
  minScore?: number;
  /** 词面重合的最低要求（相关性闸门） */
  minLexical?: number;
  /** 置信度下限（低于此值的记忆视为已归档，不参与召回） */
  archiveThreshold?: number;
  now?: Date;
}

/** 单条记忆打分：四项加权，明细一并返回（可解释性优先于精度） */
export function scoreMemoryNote(note: MemoryNote, params: RecallParams): MemoryHit {
  const now = params.now ?? new Date();
  const scoreDetail = {
    category: params.category && note.category === params.category ? 1 : 0,
    lexical: jaccard(tokenize(params.goal), tokenize(`${note.subject} ${note.summary}`)),
    confidence: note.confidence,
    recency: recencyScore(note.lastUsedAt, now),
  };
  const score =
    scoreDetail.category * WEIGHTS.category +
    scoreDetail.lexical * WEIGHTS.lexical +
    scoreDetail.confidence * WEIGHTS.confidence +
    scoreDetail.recency * WEIGHTS.recency;
  return { note, score: Math.round(score * 1000) / 1000, scoreDetail };
}

/** 召回：结构化过滤（kind / 置信度）→ 打分 → 相关性闸门 → 分数阈值 → 排序截断 */
export function recallMemories(notes: MemoryNote[], params: RecallParams): MemoryHit[] {
  const limit = params.limit ?? DEFAULT_RECALL_LIMIT;
  const minScore = params.minScore ?? MIN_RECALL_SCORE;
  const minLexical = params.minLexical ?? MIN_LEXICAL_SCORE;
  const archiveThreshold = params.archiveThreshold ?? DEFAULT_ARCHIVE_THRESHOLD;

  return notes
    .filter((n) => (params.kind ? n.kind === params.kind : true))
    .filter((n) => n.confidence >= archiveThreshold)
    .map((n) => scoreMemoryNote(n, params))
    .filter((hit) => hit.scoreDetail.lexical >= minLexical && hit.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, limit));
}
