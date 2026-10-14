// src/features/study/sessionMemory.ts
// 学习会话 → 长期记忆的**回流**（这是"计划 → 执行 → 计划更准"闭环的最后一环）。
//
// 为什么值得单独写一条记忆：计划里写的是"预计每天 60 分钟"，只有实际执行数据才能回答
// "这个估计准不准"。把预估/实际偏差写进记忆后，下一次生成计划时它会被召回，
// 模型据此调整每日投入 —— 这是本项目里唯一能自我校准的信号。
//
// 合并纪律：subjectKey 用 `study:` 前缀，**故意与计划记忆区分开**。
// 否则同一目标的"计划已接受"与"学了 85 分钟"会互相覆盖（mergeMemoryNotes 按 kind+subjectKey 合并）。
import type { GoalCategory, MemoryNote } from '../plan-generator/types';
import { normalizeSubjectKey } from '../plan-generator/services/memory/memoryWriter';
import {
  rememberNote,
  type RememberResult,
} from '../plan-generator/services/memory/memoryStore';

export interface StudyMemoryInput {
  goal: string;
  /** 本次（或累计）实际学习分钟 */
  minutes: number;
  /** 任务预估分钟（可缺省：手工任务没有预估） */
  predictedMinutes?: number;
  /** 累计会话次数（含本次） */
  sessions?: number;
  /** 收工时写的三行总结 */
  summary?: string;
  category?: GoalCategory;
  now?: Date;
}

/** 相对偏差：(实际 - 预估) / 预估；预估缺失或为 0 时返回 null */
export function deviationRatio(
  actualMinutes: number,
  predictedMinutes?: number,
): number | null {
  if (!predictedMinutes || predictedMinutes <= 0) return null;
  return (actualMinutes - predictedMinutes) / predictedMinutes;
}

/** 偏差的人话描述（+25% = 比预估多花 1/4 时间） */
export function describeDeviation(ratio: number | null): string {
  if (ratio === null) return '没有预估时长可对比';
  const pct = Math.round(ratio * 100);
  if (Math.abs(pct) < 10) return '与预估基本一致';
  return pct > 0 ? `比预估多 ${pct}%` : `比预估少 ${Math.abs(pct)}%`;
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 由一次学习会话产出一条结构化记忆 */
export function buildStudySessionNote(input: StudyMemoryInput): MemoryNote {
  const now = (input.now ?? new Date()).toISOString();
  const sessions = Math.max(1, input.sessions ?? 1);
  const ratio = deviationRatio(input.minutes, input.predictedMinutes);

  const parts = [`已完成 ${sessions} 次学习会话，共 ${Math.round(input.minutes)} 分钟`];
  if (ratio !== null) {
    parts.push(
      `本次预估 ${input.predictedMinutes} 分钟、实际 ${Math.round(input.minutes)} 分钟（${describeDeviation(ratio)}）`,
    );
  }
  if (input.summary) parts.push(`收工总结：${clip(input.summary, 60)}`);

  const evidence = [
    `study:goal:${clip(input.goal, 30)}`,
    `study:sessions:${sessions}`,
    `study:minutes:${Math.round(input.minutes)}`,
  ];
  if (input.predictedMinutes) evidence.push(`study:predicted:${input.predictedMinutes}`);

  return {
    id: `mem-study-${normalizeSubjectKey(input.goal) || 'goal'}-${Date.now().toString(36)}`,
    kind: 'episodic',
    // 前缀保证"计划记忆"与"学习记忆"各自合并，不会互相覆盖
    subjectKey: `study:${normalizeSubjectKey(input.goal)}`,
    subject: clip(input.goal, 40),
    summary: parts.join('；'),
    evidence: evidence.slice(0, 6),
    // 有真实执行数据，比"计划被接受"更可信；多次会话再加一点
    confidence: Math.min(0.8, (ratio !== null ? 0.6 : 0.5) + (sessions >= 3 ? 0.1 : 0)),
    hitCount: 0,
    createdAt: now,
    lastUsedAt: now,
    category: input.category,
    stats: {
      studySessions: sessions,
      studyMinutes: Math.round(input.minutes),
      predictedMinutes: input.predictedMinutes,
    },
  };
}

/** 写入（记忆总开关关闭时静默返回 note: null，调用方无需判断设置） */
export async function rememberStudySession(input: StudyMemoryInput): Promise<RememberResult> {
  return rememberNote(buildStudySessionNote(input), input.now ?? new Date());
}
