// src/features/plan-generator/services/agent/tools/builtin/planQueryTools.ts
// 只读工具：宿主替模型把数据"读"好，模型只负责决策。
//
// 这是相对"把所有内容一股脑塞进 prompt"的关键区别：
// 上下文由**工具**按需产出，且每个产出的文本都会被截断、被 trace 记录。
import { z } from 'zod';
import type { GeneratedPlan, MemoryHit } from '../../../../types';
import { buildMemorySection } from '../../../prompts';
import { recallForGoal } from '../../../memory/memoryStore';
import { defineSkill } from '../registry';
import type { SkillContext } from '../types';

const NO_PLAN = '当前没有可用的计划（工具必须在传入计划的会话中调用）';

function requirePlan(ctx: SkillContext): GeneratedPlan {
  if (!ctx.plan) throw new Error(NO_PLAN);
  return ctx.plan;
}

/** 计划文本摘要：供模型理解"现在是什么样"，也是变更前的人类可读快照 */
export function summarizePlanForPrompt(plan: GeneratedPlan, includeTaskTitles = true): string {
  const lines: string[] = [
    `目标：${plan.goal}（${plan.days.length} 天，类型：${plan.planType === 'tasks' ? '任务列表' : '事件时段表'}）`,
  ];
  plan.days.forEach((day, di) => {
    const tasks = day.tasks ?? [];
    const events = day.events ?? [];
    if (tasks.length > 0) {
      const total = tasks.reduce((s, t) => s + (t.estimatedMinutes || 0), 0);
      lines.push(`第${di + 1}天 ${day.date}（合计 ${total} 分钟）：`);
      tasks.forEach((t, ti) => {
        const time = t.bestTime ? `${t.bestTime} ` : '';
        lines.push(
          `  ${ti + 1}) ${includeTaskTitles ? t.title : '(略)'} ${time}${t.estimatedMinutes} 分钟`,
        );
      });
    } else if (events.length > 0) {
      lines.push(`第${di + 1}天 ${day.date}（${events.length} 个时段）：`);
      events.forEach((e, ei) => {
        lines.push(`  ${ei + 1}) ${e.startTime}-${e.endTime} ${includeTaskTitles ? e.title : '(略)'}`);
      });
    } else {
      lines.push(`第${di + 1}天 ${day.date}：（空）`);
    }
  });
  return lines.join('\n').slice(0, 2400);
}

/** 读：当前计划摘要 */
export const getPlanSummarySkill = defineSkill({
  name: 'get_plan_summary',
  title: '读取当前计划',
  description: '返回当前计划的逐日摘要（日期、每项标题、时间与时长）。修改计划前必须先读它。',
  scopes: ['plan:read'],
  sideEffect: 'read',
  paramsHint: '{ includeTaskTitles?: boolean }',
  schema: z.object({ includeTaskTitles: z.boolean().optional() }),
  execute: async (args: { includeTaskTitles?: boolean }, ctx: SkillContext) => {
    const plan = requirePlan(ctx);
    const text = summarizePlanForPrompt(plan, args.includeTaskTitles ?? true);
    return {
      text,
      days: plan.days.length,
      items: plan.days.reduce((s, d) => s + (d.tasks?.length ?? d.events?.length ?? 0), 0),
    };
  },
});

/** 读：当前计划可引用的真实资源清单（引用白名单的可读视图） */
export const getPlanResourcesSkill = defineSkill({
  name: 'get_plan_resources',
  title: '读取计划引用的资源',
  description: '返回当前计划已检索到的真实资源清单（id / 标题 / 类型）。引用资源时必须使用这里的 id。',
  scopes: ['resource:read'],
  sideEffect: 'read',
  paramsHint: '{ limit?: number }',
  schema: z.object({ limit: z.number().int().min(1).max(20).optional() }),
  execute: async (args: { limit?: number }, ctx: SkillContext) => {
    const plan = requirePlan(ctx);
    const items = (plan.resources ?? []).slice(0, args.limit ?? 10);
    return {
      count: plan.resources?.length ?? 0,
      text: items.length
        ? items.map((r) => `- id=${r.id} | [${r.type}] ${r.title}`).join('\n')
        : '（该计划没有引用任何真实资源）',
    };
  },
});

/** 读：召回与当前目标相关的历史记忆 */
export const recallMemorySkill = defineSkill({
  name: 'recall_memory',
  title: '召回历史记忆',
  description: '按当前目标召回相关的历史计划成败记录（情景记忆），供调整时参考。',
  scopes: ['memory:read'],
  sideEffect: 'read',
  paramsHint: '{ limit?: number }',
  schema: z.object({ limit: z.number().int().min(1).max(5).optional() }),
  execute: async (args: { limit?: number }, ctx: SkillContext) => {
    const plan = requirePlan(ctx);
    const hits: MemoryHit[] = await recallForGoal({
      goal: plan.goal,
      category: plan.category,
      limit: args.limit ?? 2,
      now: ctx.now,
    });
    return { hits, text: buildMemorySection(hits) };
  },
});

export const planQuerySkills = [getPlanSummarySkill, getPlanResourcesSkill, recallMemorySkill];
