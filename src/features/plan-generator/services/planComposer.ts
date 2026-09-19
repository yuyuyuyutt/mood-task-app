// src/features/plan-generator/services/planComposer.ts
// 阶段 3：计划生成。
// 输入：用户目标 + 澄清回答 + 用户画像 + 真实资源列表。
// LLM 必须为每个任务给出：标题、预估耗时、建议时间、安排理由、引用的方法论、引用的资源；
// 并输出整体策略（方法论 / ≥2 条风险 / 可验证成功标准）。
// 严禁编造链接或书名 —— 解析时会丢弃任何不在资源列表内的 resourceIds。
// LLM 未开启、失败或解析失败 → 回退到既有规则生成器（仍会附带策略与资源）。
import type {
  ClarificationAnswer,
  GeneratedPlan,
  HabitProfile,
  NetworkingSettings,
  PlanGenInput,
  PlanStrategy,
  PlanTask,
  ResourceBundle,
  ResourceItem,
} from '../types';
import { asNumber, asString, asStringArray, extractJsonObject } from './jsonExtract';
import { callOllamaText, type LLMConfig } from './llmClient';
import { buildPlanWithResourcesPrompt, buildRuleStrategy } from './prompts';
import { llmTasks } from './llmTaskManager';
import { generatePlan } from './planGenerator';
import { mergeLLMPlan } from './localLLM';
import { CATEGORY_MINUTES } from './templates';

export interface PlanV2Task {
  title: string;
  minutes: number;
  time?: string;
  reason?: string;
  methodology?: string[];
  resourceIds?: string[];
}

export interface PlanV2Raw {
  narrative?: string;
  strategy?: PlanStrategy;
  days: Array<{ date: string; tasks: PlanV2Task[] }>;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 解析阶段 3 的 LLM 输出（容错：代码块、尾随逗号、字段缺失） */
export function parsePlanV2Json(text: string): PlanV2Raw {
  const obj = extractJsonObject<Record<string, unknown>>(text);
  const daysRaw = Array.isArray(obj.days) ? obj.days : [];
  const days: PlanV2Raw['days'] = [];
  for (const d of daysRaw) {
    if (!d || typeof d !== 'object') continue;
    const day = d as Record<string, unknown>;
    const date = asString(day.date, 20);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const tasksRaw = Array.isArray(day.tasks) ? day.tasks : [];
    const tasks: PlanV2Task[] = [];
    for (const t of tasksRaw) {
      if (!t || typeof t !== 'object') continue;
      const task = t as Record<string, unknown>;
      const title = asString(task.title, 60);
      if (title.length < 2) continue;
      const timeRaw = asString(task.time, 5);
      tasks.push({
        title,
        minutes: asNumber(task.minutes, 30, 10, 180),
        time: TIME_RE.test(timeRaw) ? timeRaw : undefined,
        reason: asString(task.reason, 200) || undefined,
        methodology: asStringArray(task.methodology, 3, 24),
        resourceIds: asStringArray(task.resourceIds, 3, 60),
      });
    }
    if (tasks.length > 0) days.push({ date, tasks });
  }
  if (days.length === 0) throw new Error('未解析到任何日程');

  const strategyRaw = (obj.strategy ?? {}) as Record<string, unknown>;
  const strategy: PlanStrategy = {
    methodology: asStringArray(strategyRaw.methodology, 6, 80),
    risks: asStringArray(strategyRaw.risks, 6, 160),
    successCriteria: asStringArray(strategyRaw.successCriteria, 6, 160),
  };

  return {
    narrative: asString(obj.narrative, 800) || undefined,
    strategy,
    days,
  };
}

/** 补齐策略：方法论/成功标准缺失时用规则模板补，风险少于 2 条时补齐（硬性要求） */
export function normalizeStrategy(raw: PlanStrategy | undefined, category: string, days: number): PlanStrategy {
  const fallback = buildRuleStrategy(category, days);
  const methodology = raw?.methodology?.length ? raw.methodology.slice(0, 6) : fallback.methodology;
  const successCriteria = raw?.successCriteria?.length
    ? raw.successCriteria.slice(0, 6)
    : fallback.successCriteria;
  const risks = [...(raw?.risks ?? [])];
  for (const r of fallback.risks) {
    if (risks.length >= 2) break;
    if (!risks.includes(r)) risks.push(r);
  }
  return { methodology, risks: risks.slice(0, 6), successCriteria };
}

/** 把 LLM 给出的理由/方法论/资源 id 附加到合并后的计划上（丢弃未知资源 id —— 防编造） */
export function enrichPlanWithExtras(
  plan: GeneratedPlan,
  raw: PlanV2Raw,
  validResourceIds: Set<string>,
): { plan: GeneratedPlan; droppedCitations: number } {
  const byDate = new Map(raw.days.map((d) => [d.date, d]));
  let dropped = 0;

  const days = plan.days.map((day) => {
    const rawDay = byDate.get(day.date);
    if (!rawDay || !day.tasks) return day;
    const tasks: PlanTask[] = day.tasks.map((task, index) => {
      const rawTask = rawDay.tasks[index];
      if (!rawTask) return task;
      const resourceIds = (rawTask.resourceIds ?? []).filter((id) => {
        const ok = validResourceIds.has(id);
        if (!ok) dropped += 1;
        return ok;
      });
      return {
        ...task,
        reason: rawTask.reason ?? task.reason,
        methodology: rawTask.methodology?.length ? rawTask.methodology : task.methodology,
        resourceIds: resourceIds.length ? resourceIds : undefined,
      };
    });
    return { ...day, tasks };
  });

  return { plan: { ...plan, days }, droppedCitations: dropped };
}

/** 规则兜底：为每个任务补上"安排理由 + 方法论 + 资源引用" */
export function enrichPlanByRules(
  plan: GeneratedPlan,
  strategy: PlanStrategy,
  resources: ResourceItem[],
): GeneratedPlan {
  const usable = resources.slice(0, 9);
  let cursor = 0;
  const days = plan.days.map((day, dayIndex) => {
    if (!day.tasks) return day;
    const tasks = day.tasks.map((task, taskIndex) => {
      const refs: string[] = [];
      if (usable.length > 0) {
        refs.push(usable[cursor % usable.length].id);
        cursor += 1;
      }
      const reasonParts = [
        taskIndex === 0 ? '作为当天起步任务，先建立节奏' : '承接上一项，逐步推进',
        task.bestTime ? `安排在 ${task.bestTime}（符合你的高效时段）` : '安排在可用时段内',
        dayIndex === 0 ? '首日以熟悉材料为主' : '',
      ].filter(Boolean);
      return {
        ...task,
        reason: reasonParts.join('；'),
        methodology: strategy.methodology.slice(0, 2),
        resourceIds: refs.length > 0 ? refs : undefined,
      };
    });
    return { ...day, tasks };
  });
  return { ...plan, days };
}

export interface ComposePlanParams {
  input: PlanGenInput;
  answers: ClarificationAnswer[];
  profile?: HabitProfile | null;
  resources: ResourceBundle;
  config: LLMConfig;
  signal?: AbortSignal;
  /** 固定当前时间（测试/重放用）：保证日期白名单与外部期望一致 */
  now?: Date;
}

export interface ComposePlanResult {
  plan: GeneratedPlan;
  strategy: PlanStrategy;
  /** llm = 模型生成；rule = 规则生成器兜底 */
  source: 'llm' | 'rule';
  warnings: string[];
}

/**
 * 生成最终计划：
 * 1) 先用规则生成器产出基础计划（同时作为日期白名单与兜底）；
 * 2) LLM 可用时带"目标 + 澄清 + 画像 + 真实资源"请求改写；
 * 3) 任何失败 → 规则计划 + 规则策略 + 资源引用（计划始终可生成）。
 */
export async function composePlan(params: ComposePlanParams): Promise<ComposePlanResult> {
  const { input, answers, profile, resources, config, signal, now } = params;
  const warnings: string[] = [];

  const rulePlan = generatePlan(input, now ? { now } : {});
  const minutesPerDay =
    input.preferences?.minutesPerDay ?? CATEGORY_MINUTES[rulePlan.category] ?? 60;
  const validIds = new Set(resources.items.map((r) => r.id));

  const attach = (plan: GeneratedPlan): GeneratedPlan => ({
    ...plan,
    clarifications: answers,
    resources: resources.items,
  });

  if (!config.enabled || !config.model) {
    const strategy = normalizeStrategy(undefined, rulePlan.category, input.days);
    const enriched = enrichPlanByRules(rulePlan, strategy, resources.items);
    return {
      plan: {
        ...attach(enriched),
        strategy,
        generation: {
          source: 'rule',
          model: null,
          warnings: [config.enabled ? '未选择模型，已回退规则生成器' : 'AI 未开启，使用规则生成器'],
        },
      },
      strategy,
      source: 'rule',
      warnings: [...resources.warnings],
    };
  }

  try {
    const prompt = buildPlanWithResourcesPrompt({
      input,
      answers,
      profile,
      dates: rulePlan.days.map((d) => d.date),
      resources: resources.items,
      minutesPerDay,
    });
    const text = await llmTasks.run({
      kind: 'plan',
      key: 'plan',
      timeoutMs: config.timeoutMs ?? 120_000,
      signal,
      run: (taskSignal) => callOllamaText(prompt, config, { signal: taskSignal }),
    });

    const raw = parsePlanV2Json(text);
    const availability = input.preferences?.availability ?? { start: '08:00', end: '22:00' };
    const { plan: merged, adjustments } = mergeLLMPlan(
      rulePlan,
      { narrative: raw.narrative, days: raw.days.map((d) => ({ date: d.date, tasks: d.tasks })) },
      availability,
    );
    const { plan: enriched, droppedCitations } = enrichPlanWithExtras(merged, raw, validIds);
    if (droppedCitations > 0) {
      warnings.push(`已丢弃 ${droppedCitations} 处不在资源列表中的引用（防止编造链接）`);
    }
    warnings.push(...adjustments);

    const strategy = normalizeStrategy(raw.strategy, rulePlan.category, input.days);
    return {
      plan: {
        ...attach(enriched),
        strategy,
        llmModel: config.model,
        generation: { source: 'llm', model: config.model, warnings: [...warnings] },
      },
      strategy,
      source: 'llm',
      warnings: [...warnings, ...resources.warnings],
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const strategy = normalizeStrategy(undefined, rulePlan.category, input.days);
    const enriched = enrichPlanByRules(rulePlan, strategy, resources.items);
    return {
      plan: {
        ...attach(enriched),
        strategy,
        generation: { source: 'rule', model: null, warnings: [`AI 生成失败：${reason}`] },
      },
      strategy,
      source: 'rule',
      warnings: [`AI 计划生成失败，已回退规则生成器：${reason}`, ...resources.warnings],
    };
  }
}

/** 资源 id -> 资源对象（UI 渲染任务引用） */
export function indexResources(items: ResourceItem[]): Map<string, ResourceItem> {
  return new Map(items.map((i) => [i.id, i]));
}

export type { NetworkingSettings };
