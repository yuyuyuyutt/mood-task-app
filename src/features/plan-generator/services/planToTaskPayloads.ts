// src/features/plan-generator/services/planToTaskPayloads.ts
// 纯函数：把生成的计划转换为"任务表（数据库）"写入载荷。
// 与 IO 解耦，便于单元测试；实际写入见 taskMaterializer.ts。
import type { Task } from '../../../types';
import type { GeneratedPlan, PlanDay } from '../types';

/** 可以写入 create_task 的载荷（不含 id / created_at） */
export type NewTaskPayload = Omit<Task, 'id' | 'created_at'>;

/** 计划来源标签（写入任务 tags，便于在任务列表中识别与批量清理） */
export const PLAN_TAG = '计划生成';

/**
 * AI 生成标记前缀：完整形式 `AI 生成 · qwen2.5:7b`。
 * 为什么是标签而不是详情里的一行字：标签是**可扫读的元信息**（能在列表里一眼识别来源），
 * 而详情是给人读内容的；把"谁生成的"塞进详情，既污染内容又看不到。
 * 前缀单独导出，便于展示层把历史数据里的旧文案（`AI 润色：xxx`）迁移成同样的标签。
 */
export const AI_TAG_PREFIX = 'AI 生成';

/** 由模型名生成 AI 标签；没有模型名（规则生成）时返回 null */
export function aiGeneratedTag(model?: string | null): string | null {
  const name = (model ?? '').trim();
  if (!name) return null;
  return `${AI_TAG_PREFIX} · ${name.slice(0, 24)}`;
}

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
 * - tags = [目标短标签, 类别, PLAN_TAG, `AI 生成 · 模型名`]；
 * - description 只写**内容本身**（第几天 / 建议时段 / 安排理由 / 方法论 / 引用资源 / 建议），
 *   来源信息（计划生成 / AI 生成）一律走 tags —— 详情留给内容，元信息走标签。
 */
export function planToTaskPayloads(
  plan: GeneratedPlan,
  options: PayloadOptions = {},
): NewTaskPayload[] {
  const goalTag = plan.goal.trim().slice(0, 12);
  const aiTag = aiGeneratedTag(plan.llmModel);
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
      if (plan.aiNarrative) descParts.push(`建议：${plan.aiNarrative.slice(0, 200)}`);

      out.push({
        title: title.slice(0, 200),
        description: descParts.join('\n'),
        status: 'pending',
        priority: (i === 0 ? 1 : 2) as Task['priority'],
        estimated_time: minutes,
        due_date: day.date,
        // 来源信息全部收敛到 tags：计划生成 / AI 生成 · 模型名
        tags: Array.from(
          new Set([goalTag, plan.category, PLAN_TAG, aiTag].filter((t): t is string => !!t)),
        ),
        is_habit: false,
      });
    }
  });

  return out;
}
