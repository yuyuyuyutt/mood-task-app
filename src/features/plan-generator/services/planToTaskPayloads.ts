// src/features/plan-generator/services/planToTaskPayloads.ts
// 纯函数：把生成的计划转换为"任务表（数据库）"写入载荷。
// 与 IO 解耦，便于单元测试；实际写入见 taskMaterializer.ts。
import type { Task } from '../../../types';
import type { GeneratedPlan, PlanDay } from '../types';

/** 可以写入 create_task 的载荷（不含 id / created_at） */
export type NewTaskPayload = Omit<Task, 'id' | 'created_at'>;

/** 计划来源标签（写入任务 tags，便于在任务列表中识别与批量清理） */
export const PLAN_TAG = '计划生成';

export interface PayloadOptions {
  /** 每个计划日生成多少条任务（默认全部） */
  limitPerDay?: number;
}

/** 计算事件的分钟数（events 形态的计划同样能落库为带时长的任务） */
function eventMinutes(day: PlanDay, index: number): number {
  const ev = day.events?.[index];
  if (!ev) return 30;
  const [sh, sm] = ev.startTime.split(':').map(Number);
  const [eh, em] = ev.endTime.split(':').map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return 30;
  return Math.max(10, eh * 60 + em - (sh * 60 + sm));
}

/**
 * 生成用于写入数据库的任务载荷：
 * - 每条计划项 -> 一条真实任务，due_date = 计划中的具体日期；
 * - estimated_time = 计划分钟数；
 * - 每天第一项 priority=1（当天重点），其余 2；
 * - tags = [目标短标签, 类别, PLAN_TAG]；
 * - description 记录来源（目标 / 第几天 / 建议时段 / 安排理由 / 方法论 / 引用资源 / AI 模型）。
 */
export function planToTaskPayloads(
  plan: GeneratedPlan,
  options: PayloadOptions = {},
): NewTaskPayload[] {
  const goalTag = plan.goal.trim().slice(0, 12);
  const resourceIndex = new Map((plan.resources ?? []).map((r) => [r.id, r]));
  const out: NewTaskPayload[] = [];

  plan.days.forEach((day, dayIndex) => {
    const items = day.tasks ?? [];
    const eventItems = day.events ?? [];
    const count = items.length > 0 ? items.length : eventItems.length;
    const limit = options.limitPerDay ?? count;

    for (let i = 0; i < Math.min(count, limit); i++) {
      const isTaskShape = items.length > 0;
      const task = isTaskShape ? items[i] : undefined;
      const title = isTaskShape ? items[i].title : eventItems[i].title;
      const minutes = isTaskShape ? items[i].estimatedMinutes : eventMinutes(day, i);
      const bestTime = isTaskShape ? items[i].bestTime : `${eventItems[i].startTime}-${eventItems[i].endTime}`;

      const descParts = [
        `来自「个性化计划生成器」`,
        `目标：${plan.goal}`,
        `进度：第 ${dayIndex + 1}/${plan.days.length} 天`,
      ];
      if (bestTime) descParts.push(`建议时段：${bestTime}`);
      if (task?.reason) descParts.push(`安排理由：${task.reason}`);
      if (task?.methodology?.length) descParts.push(`方法论：${task.methodology.join('、')}`);

      // 引用资源：只写入标题与链接（元数据），便于任务执行时直接打开
      const refs = (task?.resourceIds ?? [])
        .map((id) => resourceIndex.get(id))
        .filter((r): r is NonNullable<typeof r> => !!r)
        .slice(0, 3);
      if (refs.length > 0) {
        descParts.push(`引用资源：\n${refs.map((r) => `· [${r.type}] ${r.title} — ${r.url}`).join('\n')}`);
      }

      if (plan.strategy?.successCriteria?.length) {
        descParts.push(`成功标准：${plan.strategy.successCriteria[0]}`);
      }
      if (plan.llmModel) descParts.push(`AI 润色：${plan.llmModel}`);
      if (plan.aiNarrative) descParts.push(`建议：${plan.aiNarrative.slice(0, 200)}`);

      out.push({
        title: title.slice(0, 200),
        description: descParts.join('\n'),
        status: 'pending',
        priority: (i === 0 ? 1 : 2) as Task['priority'],
        estimated_time: minutes,
        due_date: day.date,
        tags: Array.from(new Set([goalTag, plan.category, PLAN_TAG].filter(Boolean))),
        is_habit: false,
      });
    }
  });

  return out;
}
