// src/features/plan-generator/services/memory/memoryWriter.ts
// 记忆的**写入与维护**（纯函数，无 IO —— 便于单测，IO 在 memoryStore.ts）。
//
// 写入纪律（这是"记忆会不会越积越脏"的答案）：
//   1) 不做对话囤积：一次 run 只产出一条**结论 + 证据引用 + 置信度**的 MemoryNote；
//   2) 同 subjectKey 的记忆**合并**而不是新增，避免同一目标反复执行后堆出十几条近乎重复的记录；
//   3) 长期未被召回的记忆按衰减因子降置信度，低于阈值即"归档"（不参与召回，也不删除）。
import type { GeneratedPlan, MemoryNote, PlanDay, PlanTask } from '../../types';

export interface PlanMemoryInput {
  plan: GeneratedPlan;
  /** 用户是否接受了这份计划 */
  accepted: boolean;
  /** 拒绝时用户填写的反馈（原样保留前 60 字，便于回看原因） */
  feedback?: string | null;
  /** 计划生成时的历史完成率（来自 habitAnalyzer，可选） */
  completionRate?: number;
  now?: Date;
}

/** 主题归一化：去掉空白/标点、转小写，供相似合并使用 */
export function normalizeSubjectKey(goal: string): string {
  return goal
    .toLowerCase()
    .replace(/[\s，。、；：！？,.;:!?"'`（）()[\]【】《》\-_/\\]+/g, '')
    .slice(0, 24);
}

function planItems(plan: GeneratedPlan): PlanTask[] {
  return plan.days.flatMap((d: PlanDay) => d.tasks ?? []);
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 由一份计划产出一条结构化记忆 */
export function buildMemoryNote(input: PlanMemoryInput): MemoryNote {
  const { plan, accepted, feedback, completionRate } = input;
  const now = (input.now ?? new Date()).toISOString();
  const items = planItems(plan);
  const totalMinutes = items.reduce((s, t) => s + (t.estimatedMinutes || 0), 0);
  const avgPerDay = plan.days.length > 0 ? Math.round(totalMinutes / plan.days.length) : 0;

  const summary = accepted
    ? `已接受 ${plan.days.length} 天计划（${items.length} 项，日均 ${avgPerDay} 分钟）${
        typeof completionRate === 'number' ? `，当时历史完成率 ${Math.round(completionRate * 100)}%` : ''
      }`
    : `被判定为不合适${feedback ? `：${clip(feedback, 60)}` : ''}`;

  const evidence = [`plan:${plan.id}`, `goal:${plan.goal}`, `createdAt:${plan.createdAt}`];
  if (feedback) evidence.push(`feedback:${clip(feedback, 60)}`);

  return {
    id: `mem-${normalizeSubjectKey(plan.goal) || 'goal'}-${Date.now().toString(36)}`,
    kind: 'episodic',
    subjectKey: normalizeSubjectKey(plan.goal),
    subject: clip(plan.goal, 40),
    summary,
    evidence: evidence.slice(0, 6),
    // 接受过的计划比被拒绝的更"可信"：作为后续召回的排序依据
    confidence: accepted ? 0.6 : 0.35,
    hitCount: 0,
    createdAt: now,
    lastUsedAt: now,
    sourcePlanId: plan.id,
    category: plan.category,
    stats: {
      accepted,
      completionRate,
      plannedDays: plan.days.length,
      plannedItems: items.length,
      riskHits: plan.strategy?.risks.slice(0, 2),
    },
  };
}

export interface MergeResult {
  notes: MemoryNote[];
  merged: boolean;
}

/**
 * 合并写入：同 kind + subjectKey 的记忆只保留一条。
 * 合并时：取最新结论与统计事实，证据去重累积，置信度上调（封顶 0.95）。
 */
export function mergeMemoryNotes(
  existing: MemoryNote[],
  incoming: MemoryNote,
  now: Date = new Date(),
): MergeResult {
  const index = existing.findIndex(
    (n) => n.kind === incoming.kind && n.subjectKey === incoming.subjectKey,
  );
  if (index < 0) return { notes: [...existing, incoming], merged: false };

  const prev = existing[index];
  const mergedNote: MemoryNote = {
    ...prev,
    summary: incoming.summary,
    evidence: Array.from(new Set([...prev.evidence, ...incoming.evidence])).slice(0, 6),
    confidence: Math.min(0.95, Math.max(prev.confidence, incoming.confidence) + 0.1),
    sourcePlanId: incoming.sourcePlanId ?? prev.sourcePlanId,
    category: incoming.category ?? prev.category,
    stats: incoming.stats ?? prev.stats,
    lastUsedAt: now.toISOString(),
  };
  const notes = [...existing];
  notes[index] = mergedNote;
  return { notes, merged: true };
}

export interface DecayOptions {
  /** 超过这么多天没有被写入/召回就衰减一次 */
  idleDays?: number;
  /** 单次衰减因子 */
  factor?: number;
  /** 置信度下限 */
  floor?: number;
}

/**
 * 衰减：只对"长期未动"的记忆做一次性降权（幂等程度由 idleDays 控制），
 * 与插件数据保留期的做法一致 —— 到期才处理，不是每次访问都算。
 */
export function decayMemoryNotes(
  notes: MemoryNote[],
  now: Date = new Date(),
  options: DecayOptions = {},
): { notes: MemoryNote[]; decayed: number } {
  const { idleDays = 30, factor = 0.9, floor = 0.15 } = options;
  let decayed = 0;
  const next = notes.map((note) => {
    const idleMs = now.getTime() - Date.parse(note.lastUsedAt);
    if (!Number.isFinite(idleMs) || idleMs < idleDays * 24 * 3600 * 1000) return note;
    const confidence = Math.max(floor, Math.round(note.confidence * factor * 100) / 100);
    if (confidence === note.confidence) return note;
    decayed += 1;
    return { ...note, confidence };
  });
  return { notes: next, decayed };
}

/** 归档判定：低于阈值的记忆保留在库里，但不再参与召回（可被用户手动删除） */
export const DEFAULT_ARCHIVE_THRESHOLD = 0.15;

export function isArchived(note: MemoryNote, threshold = DEFAULT_ARCHIVE_THRESHOLD): boolean {
  return note.confidence < threshold;
}
