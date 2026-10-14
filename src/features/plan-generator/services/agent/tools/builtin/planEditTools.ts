// src/features/plan-generator/services/agent/tools/builtin/planEditTools.ts
// 写工具（计划编辑）：**全部是纯计算**，产出 PlanEditDiff，由用户确认后由宿主应用。
//
// 为什么不做成"直接改文件"的工具：因为 LLM 的职责是"决定改什么"，
// 而"改成什么样"必须是确定性代码算出来的。这样：
//   - 变更可以精确预览（before/after 一行行给用户看）；
//   - diff 可单测（不依赖模型、不依赖 UI）；
//   - 确认前零副作用，确认后也只是把一个纯函数结果贴回草稿。
import { z } from 'zod';
import type { GeneratedPlan, PlanDay } from '../../../../types';
import { defineSkill } from '../registry';
import type { PlanEditChange, PlanEditDiff, SkillContext } from '../types';

const PLAN_SCOPES = ['plan:read', 'plan:write'] as const;

function requirePlan(ctx: SkillContext): GeneratedPlan {
  if (!ctx.plan) throw new Error('当前没有可用的计划');
  return ctx.plan;
}

/** 日期偏移（本地时区，按天粒度，避免 UTC 偏差导致的"差一天"） */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function withDays(plan: GeneratedPlan, days: PlanDay[]): GeneratedPlan {
  return { ...plan, days };
}

function resolveDay(plan: GeneratedPlan, dayNumber: number): { index: number; day: PlanDay } {
  if (dayNumber < 1 || dayNumber > plan.days.length) {
    throw new Error(`第 ${dayNumber} 天超出范围（当前计划共 ${plan.days.length} 天）`);
  }
  return { index: dayNumber - 1, day: plan.days[dayNumber - 1] };
}

function resolveTask(
  plan: GeneratedPlan,
  dayNumber: number,
  itemNumber: number,
): { dayIndex: number; taskIndex: number; day: PlanDay; title: string; minutes: number } {
  const { index, day } = resolveDay(plan, dayNumber);
  const tasks = day.tasks ?? [];
  if (tasks.length === 0) throw new Error(`第 ${dayNumber} 天没有任务项（可能是时段表）`);
  if (itemNumber < 1 || itemNumber > tasks.length) {
    throw new Error(`第 ${dayNumber} 天只有 ${tasks.length} 项，找不到第 ${itemNumber} 项`);
  }
  const task = tasks[itemNumber - 1];
  return {
    dayIndex: index,
    taskIndex: itemNumber - 1,
    day,
    title: task.title,
    minutes: task.estimatedMinutes,
  };
}

/** 把一组时长压到目标总和以内：优先削最长项，每项不低于 10 分钟 */
export function fitMinutesToTarget(minutes: number[], target: number): number[] {
  const out = [...minutes];
  const total = () => out.reduce((s, v) => s + v, 0);
  let guard = 0;
  while (total() > target && guard < 500) {
    let idx = -1;
    for (let i = 0; i < out.length; i++) {
      if (out[i] <= 10) continue;
      if (idx < 0 || out[i] > out[idx]) idx = i;
    }
    if (idx < 0) break; // 全部已到下限：受"每项 ≥10 分钟"约束，无法再压
    out[idx] = Math.max(10, out[idx] - 5);
    guard += 1;
  }
  return out;
}

// ---------------- 1) 整段顺延 ----------------

interface ShiftResult {
  shifts: Array<{ from: string; to: string }>;
  moved: number;
  days: number;
}

export const shiftPlanDaysSkill = defineSkill<{ days: number; fromDay?: number }, ShiftResult>({
  name: 'shift_plan_days',
  title: '整段顺延',
  description: '把计划从第 fromDay 天起的所有日期整体顺延 N 天（用户说"出差顺延两天""往后推一周"时用）。',
  scopes: [...PLAN_SCOPES],
  sideEffect: 'write',
  paramsHint: '{ days: number(1-14), fromDay?: number(默认 1，从第几天开始顺延) }',
  schema: z.object({
    days: z.number().int().min(1).max(14),
    fromDay: z.number().int().min(1).max(60).optional(),
  }),
  execute: async (args: { days: number; fromDay?: number }, ctx: SkillContext) => {
    const plan = requirePlan(ctx);
    const from = args.fromDay ?? 1;
    if (from > plan.days.length) throw new Error(`第 ${from} 天超出范围（共 ${plan.days.length} 天）`);
    const shifts = plan.days.map((d, i) => ({
      from: d.date,
      to: i >= from - 1 ? addDays(d.date, args.days) : d.date,
    }));
    const moved = shifts.filter((s) => s.from !== s.to).length;
    if (moved === 0) throw new Error('没有需要顺延的日期');
    return { shifts, moved, days: args.days };
  },
  preview: (args: { days: number; fromDay?: number }, result: ShiftResult): PlanEditDiff => {
    const changes: PlanEditChange[] = result.shifts
      .filter((s) => s.from !== s.to)
      .map((s) => ({ kind: 'shift_day', day: s.to, from: s.from, title: s.from, detail: `顺延至 ${s.to}` }));
    return {
      skill: 'shift_plan_days',
      summary: `把第 ${args.fromDay ?? 1} 天起的 ${result.moved} 天整体顺延 ${result.days} 天`,
      changes,
      apply: (plan: GeneratedPlan) =>
        withDays(
          plan,
          plan.days.map((d, i) => ({ ...d, date: result.shifts[i]?.to ?? d.date })),
        ),
    };
  },
});

// ---------------- 2) 压缩每日时长 ----------------

interface CompressResult {
  target: number;
  perDay: Array<{ date: string; before: number; after: number; minutes: number[] }>;
  changed: number;
}

export const compressDailyMinutesSkill = defineSkill<{ minutes: number }, CompressResult>({
  name: 'compress_daily_minutes',
  title: '压缩每日时长',
  description: '把每天的任务总时长压缩到不超过 N 分钟（用户说"每天只能 40 分钟"时用）。单项下限 10 分钟。',
  scopes: [...PLAN_SCOPES],
  sideEffect: 'write',
  paramsHint: '{ minutes: number(10-240，每天目标总分钟数) }',
  schema: z.object({ minutes: z.number().int().min(10).max(240) }),
  execute: async (args: { minutes: number }, ctx: SkillContext) => {
    const plan = requirePlan(ctx);
    const perDay = plan.days.map((day) => {
      const tasks = day.tasks ?? [];
      const before = tasks.reduce((s, t) => s + (t.estimatedMinutes || 0), 0);
      if (tasks.length === 0 || before <= args.minutes) {
        return { date: day.date, before, after: before, minutes: tasks.map((t) => t.estimatedMinutes) };
      }
      const minutes = fitMinutesToTarget(
        tasks.map((t) => t.estimatedMinutes),
        args.minutes,
      );
      return { date: day.date, before, after: minutes.reduce((s, v) => s + v, 0), minutes };
    });
    const changed = perDay.filter((d) => d.after !== d.before).length;
    if (changed === 0) throw new Error(`每天的时长都已经在 ${args.minutes} 分钟以内，无需压缩`);
    return { target: args.minutes, perDay, changed };
  },
  preview: (_args: { minutes: number }, result: CompressResult): PlanEditDiff => {
    const changedDays = result.perDay.filter((d) => d.after !== d.before);
    const changes: PlanEditChange[] = changedDays.map((d) => ({
      kind: 'compress_day',
      day: d.date,
      title: d.date,
      detail: `${d.before} 分钟 → ${d.after} 分钟`,
    }));
    const unreachable = changedDays.some((d) => d.after > result.target);
    return {
      skill: 'compress_daily_minutes',
      summary: `压缩 ${result.changed} 天到每天约 ${result.target} 分钟${
        unreachable ? '（受每项最少 10 分钟限制，部分天无法完全达标）' : ''
      }`,
      changes,
      apply: (plan: GeneratedPlan) =>
        withDays(
          plan,
          plan.days.map((day, i) => {
            const computed = result.perDay[i];
            if (!day.tasks || !computed || computed.after === computed.before) return day;
            return {
              ...day,
              tasks: day.tasks.map((t, ti) => ({
                ...t,
                estimatedMinutes: computed.minutes[ti] ?? t.estimatedMinutes,
              })),
            };
          }),
        ),
    };
  },
});

// ---------------- 3) 删除单项 ----------------

interface RemoveResult {
  dayIndex: number;
  taskIndex: number;
  date: string;
  title: string;
}

export const removeTaskSkill = defineSkill<{ day: number; item: number }, RemoveResult>({
  name: 'remove_task',
  title: '删除某一项',
  description: '删除第 day 天的第 item 项任务（1 基序号）。若删除后当天将为空则拒绝。',
  scopes: [...PLAN_SCOPES],
  sideEffect: 'write',
  paramsHint: '{ day: number(1 基), item: number(1 基) }',
  schema: z.object({ day: z.number().int().min(1), item: z.number().int().min(1) }),
  execute: async (args: { day: number; item: number }, ctx: SkillContext) => {
    const plan = requirePlan(ctx);
    const resolved = resolveTask(plan, args.day, args.item);
    if ((resolved.day.tasks?.length ?? 0) <= 1) {
      throw new Error('该天只有 1 项，删除后当天会变空，已拒绝（可改用压缩时长）');
    }
    return {
      dayIndex: resolved.dayIndex,
      taskIndex: resolved.taskIndex,
      date: resolved.day.date,
      title: resolved.title,
    };
  },
  preview: (_args: { day: number; item: number }, result: RemoveResult): PlanEditDiff => ({
    skill: 'remove_task',
    summary: `删除 ${result.date} 的「${result.title}」`,
    changes: [
      {
        kind: 'remove_task',
        day: result.date,
        title: result.title,
        detail: `移除第 ${result.taskIndex + 1} 项`,
      },
    ],
    apply: (plan: GeneratedPlan) =>
      withDays(
        plan,
        plan.days.map((day, di) =>
          di === result.dayIndex && day.tasks
            ? { ...day, tasks: day.tasks.filter((_t, ti) => ti !== result.taskIndex) }
            : day,
        ),
      ),
  }),
});

// ---------------- 4) 重命名单项 ----------------

interface RenameResult {
  dayIndex: number;
  taskIndex: number;
  date: string;
  before: string;
  after: string;
}

export const renameTaskSkill = defineSkill<
  { day: number; item: number; title: string },
  RenameResult
>({
  name: 'rename_task',
  title: '改写某一项',
  description: '把第 day 天第 item 项的标题改写为 title（用户觉得某个任务描述不合适时用）。',
  scopes: [...PLAN_SCOPES],
  sideEffect: 'write',
  paramsHint: '{ day: number(1 基), item: number(1 基), title: string(2-60 字) }',
  schema: z.object({
    day: z.number().int().min(1),
    item: z.number().int().min(1),
    title: z.string().min(2).max(60),
  }),
  execute: async (args: { day: number; item: number; title: string }, ctx: SkillContext) => {
    const plan = requirePlan(ctx);
    const resolved = resolveTask(plan, args.day, args.item);
    const after = args.title.trim();
    if (after === resolved.title) throw new Error('新标题与原标题相同，无需修改');
    return {
      dayIndex: resolved.dayIndex,
      taskIndex: resolved.taskIndex,
      date: resolved.day.date,
      before: resolved.title,
      after,
    };
  },
  preview: (_args: { day: number; item: number; title: string }, result: RenameResult): PlanEditDiff => ({
    skill: 'rename_task',
    summary: `把 ${result.date} 的「${result.before}」改写为「${result.after}」`,
    changes: [
      {
        kind: 'rename_task',
        day: result.date,
        title: result.after,
        detail: `${result.before} → ${result.after}`,
      },
    ],
    apply: (plan: GeneratedPlan) =>
      withDays(
        plan,
        plan.days.map((day, di) =>
          di === result.dayIndex && day.tasks
            ? {
                ...day,
                tasks: day.tasks.map((t, ti) =>
                  ti === result.taskIndex ? { ...t, title: result.after } : t,
                ),
              }
            : day,
        ),
      ),
  }),
});

// ---------------- 5) 移动到另一天 ----------------

interface MoveResult {
  dayIndex: number;
  taskIndex: number;
  targetIndex: number;
  fromDate: string;
  toDate: string;
  title: string;
}

export const moveTaskToDaySkill = defineSkill<
  { day: number; item: number; toDay: number },
  MoveResult
>({
  name: 'move_task_to_day',
  title: '把某项挪到另一天',
  description: '把第 day 天的第 item 项移动到第 toDay 天（用户在"这天没空，挪到后面"时用）。',
  scopes: [...PLAN_SCOPES],
  sideEffect: 'write',
  paramsHint: '{ day: number(1 基), item: number(1 基), toDay: number(1 基) }',
  schema: z.object({
    day: z.number().int().min(1),
    item: z.number().int().min(1),
    toDay: z.number().int().min(1),
  }),
  execute: async (args: { day: number; item: number; toDay: number }, ctx: SkillContext) => {
    const plan = requirePlan(ctx);
    if (args.day === args.toDay) throw new Error('源日期与目标日期相同，无需移动');
    const resolved = resolveTask(plan, args.day, args.item);
    const { index: targetIndex, day: targetDay } = resolveDay(plan, args.toDay);
    if (!targetDay.tasks || targetDay.tasks.length === 0) {
      throw new Error(`第 ${args.toDay} 天不是任务列表（或为空），无法接收任务项`);
    }
    return {
      dayIndex: resolved.dayIndex,
      taskIndex: resolved.taskIndex,
      targetIndex,
      fromDate: resolved.day.date,
      toDate: targetDay.date,
      title: resolved.title,
    };
  },
  preview: (
    _args: { day: number; item: number; toDay: number },
    result: MoveResult,
  ): PlanEditDiff => ({
    skill: 'move_task_to_day',
    summary: `把「${result.title}」从 ${result.fromDate} 挪到 ${result.toDate}`,
    changes: [
      {
        kind: 'move_task',
        day: result.toDate,
        from: result.fromDate,
        title: result.title,
        detail: `${result.fromDate} → ${result.toDate}`,
      },
    ],
    apply: (plan: GeneratedPlan) => {
      const source = plan.days[result.dayIndex];
      const task = source.tasks?.[result.taskIndex];
      if (!task) return plan;
      const days = plan.days.map((day, di) => {
        if (di === result.dayIndex && day.tasks) {
          return { ...day, tasks: day.tasks.filter((_t, ti) => ti !== result.taskIndex) };
        }
        if (di === result.targetIndex && day.tasks) {
          return { ...day, tasks: [...day.tasks, task] };
        }
        return day;
      });
      return withDays(plan, days);
    },
  }),
});

export const planEditSkills = [
  shiftPlanDaysSkill,
  compressDailyMinutesSkill,
  removeTaskSkill,
  renameTaskSkill,
  moveTaskToDaySkill,
];
