// src/features/study/review.ts
// 间隔重复复习（简化 SM-2 的"固定间隔"版本）——纯函数。
//
// 为什么不做完整的 SM-2：那需要"每次复习后的自评质量（0–5）"输入，
// 而这里的输入只有"这条任务学完了"。**用不起的数据不假装用**：
// 固定 1 / 3 / 7 / 16 天四档已经能覆盖"当天记住、隔天回忆、一周巩固、半个月回看"的节奏，
// 而且用户一眼能看懂为什么是这四天。
//
// 写库纪律：复习任务**不新建写通道**，走既有 `api.createTask`；
// 也不打 `计划生成` 标签，避免被任务列表的"计划队列"当成计划条目（它们不该被逐条解锁隐藏）。
import type { Task } from '../../types';
import type { GoalCategory } from '../plan-generator/types';
import type { StudyReviewPlan } from './types';

/** 四档复习间隔（天） */
export const REVIEW_INTERVALS_DAYS = [1, 3, 7, 16] as const;

/** 学习工作区自己的标签（用于识别来源与批量清理） */
export const STUDY_TAG = '学习工作区';
/** 复习任务标签 */
export const REVIEW_TAG = '复习';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toDateStr(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 从基准时间往后加天数，返回 'YYYY-MM-DD' */
export function addDays(base: Date, days: number): string {
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

export interface BuildReviewPlanInput {
  goal: string;
  /** 学完的那条任务标题（复习任务挂在它下面） */
  taskTitle: string;
  /** 单次复习时长（默认取原任务时长的 40%，下限 10 分钟） */
  minutes?: number;
  from?: Date;
  /** 只排前 N 档（默认四档全排） */
  rounds?: number;
}

/** 单次复习时长：原时长的 40%（下限 10 分钟、上限 60 分钟）——复习不该比第一次学还久 */
export function reviewMinutes(sourceMinutes?: number): number {
  const base = sourceMinutes && sourceMinutes > 0 ? sourceMinutes : 30;
  return Math.min(60, Math.max(10, Math.round(base * 0.4)));
}

export function buildReviewPlan(input: BuildReviewPlanInput): StudyReviewPlan {
  const from = input.from ?? new Date();
  const rounds = Math.max(1, Math.min(REVIEW_INTERVALS_DAYS.length, input.rounds ?? REVIEW_INTERVALS_DAYS.length));
  const minutes = reviewMinutes(input.minutes);

  return {
    goal: input.goal,
    items: REVIEW_INTERVALS_DAYS.slice(0, rounds).map((days, index) => ({
      dueDate: addDays(from, days),
      title: `复习：${input.taskTitle}`,
      minutes,
      round: index + 1,
    })),
  };
}

/**
 * 把复习安排转成任务载荷（`api.createTask` 的入参形状）。
 * 描述里只写**内容**（对应哪条内容、第几次复习），来源信息走标签 —— 与计划任务的纪律一致。
 */
export function reviewTaskPayloads(
  plan: StudyReviewPlan,
  options: { category?: GoalCategory } = {},
): Array<Omit<Task, 'id' | 'created_at'>> {
  const goalTag = plan.goal.trim().slice(0, 12);
  const tags = [goalTag, options.category, STUDY_TAG, REVIEW_TAG].filter(
    (t): t is string => !!t,
  );

  return plan.items.map((item, index) => ({
    title: item.title.slice(0, 200),
    description: [
      `对应内容：${item.title.replace(/^复习：/, '')}`,
      `间隔：第 ${item.round}/${plan.items.length} 次复习（${REVIEW_INTERVALS_DAYS.join(' / ')} 天）`,
      '复习方式建议：先合上材料回忆一遍，再回看资源里对不上的部分。',
    ].join('\n'),
    status: 'pending' as const,
    // 第一次复习优先度高一点（最容易忘的是这一天）
    priority: (index === 0 ? 1 : 2) as Task['priority'],
    estimated_time: item.minutes,
    due_date: item.dueDate,
    tags: Array.from(new Set(tags)),
    is_habit: false,
  }));
}
