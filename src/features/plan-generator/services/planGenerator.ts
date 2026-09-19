// src/features/plan-generator/services/planGenerator.ts
// 计划生成器：模板 + 规则，纯本地、确定性（无远程 API）。
// - 根据目标文本识别类别（学习/健身/工作/创作/通用）；
// - 依据用户类型/风格把"每日投入"拆成任务列表或事件时段表；
// - 输出结构：
//   tasks  -> { date, tasks: [{ title, category, estimatedMinutes, bestTime }] }
//   events -> { date, events: [{ title, category, startTime, endTime }] }
import type {
  GeneratedPlan,
  PlanDay,
  PlanGenInput,
  PlanTask,
  PlanType,
  UserType,
} from '../types';
import {
  CATEGORY_MINUTES,
  buildDayEvents,
  buildDayTasks,
  detectGoalCategory,
  preferredBlocks,
  toMinutes,
  type TimeBlock,
} from './templates';

export const MAX_PLAN_DAYS = 30;
export const MIN_PLAN_DAYS = 1;

const DEFAULT_AVAILABILITY = { start: '08:00', end: '22:00' };

export interface GenerateOptions {
  /** 固定当前时间（测试用） */
  now?: Date;
  /** 固定计划 id（测试/重放用） */
  id?: string;
}

function dateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

export function generatePlan(input: PlanGenInput, options: GenerateOptions = {}): GeneratedPlan {
  const goal = input.goal.trim() || '我的目标';
  const days = Math.min(MAX_PLAN_DAYS, Math.max(MIN_PLAN_DAYS, Math.floor(input.days) || 1));
  const planType: PlanType = input.planType === 'events' ? 'events' : 'tasks';
  const userType: UserType = input.userType || 'balanced';
  const category = input.category ?? detectGoalCategory(goal);
  const prefs = input.preferences ?? {};

  const availability = validAvailability(prefs.availability) ? prefs.availability! : DEFAULT_AVAILABILITY;
  const minutesPerDay = Math.min(
    480,
    Math.max(15, prefs.minutesPerDay ?? CATEGORY_MINUTES[category]),
  );
  const style = prefs.style ?? 'auto';
  const includeWeekend = prefs.includeWeekend !== false;

  const blocks: TimeBlock[] = preferredBlocks(userType, availability);
  const now = options.now ?? new Date();

  // 从明天起取 days 天（可选择跳过周末）
  const planDays: PlanDay[] = [];
  const cursor = new Date(now);
  while (planDays.length < days) {
    cursor.setDate(cursor.getDate() + 1);
    if (!includeWeekend && isWeekend(cursor)) continue;
    const dayIndex = planDays.length;
    const date = dateString(cursor);
    const common = {
      goal,
      category,
      dayIndex,
      totalDays: days,
      userType,
      style,
      minutesPerDay,
      blocks,
    };
    planDays.push(
      planType === 'events'
        ? { date, events: buildDayEvents(common) }
        : { date, tasks: buildDayTasks(common) },
    );
  }

  const id =
    options.id ??
    `plan-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id,
    goal,
    planType,
    userType,
    category,
    createdAt: now.toISOString(),
    engineVersion: 1,
    days: planDays,
    feedback: null,
    accepted: false,
  };
}

/** 汇总计划工作量（展示用）：总任务数/总分钟/每日平均 */
export function summarizePlan(plan: GeneratedPlan): {
  itemCount: number;
  totalMinutes: number;
  avgPerDay: number;
} {
  let itemCount = 0;
  let totalMinutes = 0;
  for (const day of plan.days) {
    if (day.tasks) {
      itemCount += day.tasks.length;
      totalMinutes += day.tasks.reduce((s, t) => s + (t.estimatedMinutes || 0), 0);
    } else if (day.events) {
      itemCount += day.events.length;
      for (const ev of day.events) {
        const s = toMinutes(ev.startTime);
        const e = toMinutes(ev.endTime);
        if (Number.isFinite(s) && Number.isFinite(e)) totalMinutes += Math.max(0, e - s);
      }
    }
  }
  return {
    itemCount,
    totalMinutes,
    avgPerDay: Math.round(totalMinutes / plan.days.length),
  };
}

/** 排序（检查事件不重叠）等辅助 */
export function isEventsSorted(plan: GeneratedPlan): boolean {
  return plan.days.every((d) => {
    const evs = d.events;
    if (!evs) return true;
    for (let i = 1; i < evs.length; i++) {
      if (toMinutes(evs[i].startTime) < toMinutes(evs[i - 1].endTime)) return false;
    }
    return true;
  });
}

function validAvailability(a?: { start: string; end: string }): boolean {
  if (!a) return false;
  const s = toMinutes(a.start);
  const e = toMinutes(a.end);
  return Number.isFinite(s) && Number.isFinite(e) && e - s >= 25;
}

export function tasksPerDayEstimate(plan: GeneratedPlan): number {
  const counts = plan.days.map((d) => (d.tasks ? d.tasks.length : d.events?.length ?? 0));
  return counts.length > 0 ? Math.round(counts.reduce((a, b) => a + b, 0) / counts.length) : 0;
}

export type { PlanTask };
