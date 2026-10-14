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
  MemoryHit,
  NetworkingSettings,
  PlanGenInput,
  PlanStrategy,
  PlanTask,
  ResourceBundle,
  ResourceItem,
} from '../types';
import { asNumber, asString, asStringArray, extractJsonObject } from './jsonExtract';
import type { LLMConfig } from './llmClient';
import { callChat } from './llm/chatClient';
import { PLAN_SCHEMA } from './llm/schemas';
import { PROMPT_VERSION, buildMemorySection, buildPlanMessages, buildRuleStrategy } from './prompts';
import { TraceRecorder } from './agent/trace';
import { llmTasks } from './llmTaskManager';
import { generatePlan } from './planGenerator';
import { mergeLLMPlan } from './localLLM';
import { CATEGORY_MINUTES } from './templates';
import { evidenceIdSet, summarizeEvidence, type EvidencePack } from './rag/evidence';

export interface PlanV2Task {
  title: string;
  minutes: number;
  time?: string;
  reason?: string;
  methodology?: string[];
  resourceIds?: string[];
  /** 引用的正文证据编号（E1、E2…），仅当证据段落被注入时才有意义 */
  evidenceIds?: string[];
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
        evidenceIds: asStringArray(task.evidenceIds, 3, 12),
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

/** 引用统计：既是 UI 提示的数据来源，也是离线评测里 citation precision 的分子分母 */
export interface CitationStats {
  /** 通过白名单、真正写进计划的资源引用数 */
  resourcesKept: number;
  /** 被白名单丢弃的资源引用数（模型编造的） */
  resourcesDropped: number;
  /** 通过白名单、真正写进计划的证据引用数 */
  evidenceKept: number;
  /** 被白名单丢弃的证据引用数 */
  evidenceDropped: number;
}

export const EMPTY_CITATION_STATS: CitationStats = {
  resourcesKept: 0,
  resourcesDropped: 0,
  evidenceKept: 0,
  evidenceDropped: 0,
};

/**
 * 把 LLM 给出的理由/方法论/资源 id 附加到合并后的计划上。
 * **所有引用都要过白名单**：不在允许集合里的 id 一律丢弃并计数（防编造链接/依据）。
 * 顺便统计 kept/dropped —— 有了这两个数，citation precision 才是可算的指标，
 * 而不是只能从 warning 文案里正则抠数字。
 */
export function enrichPlanWithExtras(
  plan: GeneratedPlan,
  raw: PlanV2Raw,
  validResourceIds: Set<string>,
  /** 可选：允许引用的正文证据编号集合（不传 = 本次没注入证据，evidenceIds 一律丢弃） */
  validEvidenceIds?: Set<string>,
): { plan: GeneratedPlan; droppedCitations: number; droppedEvidence: number; citations: CitationStats } {
  const byDate = new Map(raw.days.map((d) => [d.date, d]));
  const citations: CitationStats = { ...EMPTY_CITATION_STATS };

  const days = plan.days.map((day) => {
    const rawDay = byDate.get(day.date);
    if (!rawDay || !day.tasks) return day;
    const tasks: PlanTask[] = day.tasks.map((task, index) => {
      const rawTask = rawDay.tasks[index];
      if (!rawTask) return task;
      const resourceIds = (rawTask.resourceIds ?? []).filter((id) => {
        const ok = validResourceIds.has(id);
        if (ok) citations.resourcesKept += 1;
        else citations.resourcesDropped += 1;
        return ok;
      });
      // 证据引用同样走"白名单 + 丢弃计数"：模型没读到过的证据编号不允许出现
      const evidenceIds = (rawTask.evidenceIds ?? []).filter((id) => {
        const ok = Boolean(validEvidenceIds?.has(id));
        if (ok) citations.evidenceKept += 1;
        else citations.evidenceDropped += 1;
        return ok;
      });
      return {
        ...task,
        reason: rawTask.reason ?? task.reason,
        methodology: rawTask.methodology?.length ? rawTask.methodology : task.methodology,
        resourceIds: resourceIds.length ? resourceIds : undefined,
        evidenceIds: evidenceIds.length ? evidenceIds : undefined,
      };
    });
    return { ...day, tasks };
  });

  return {
    plan: { ...plan, days },
    droppedCitations: citations.resourcesDropped,
    droppedEvidence: citations.evidenceDropped,
    citations,
  };
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
  /** 召回的历史记忆（由 memoryRetriever 产出；为空则不注入"历史参考"段落） */
  memoryHits?: MemoryHit[];
  /**
   * 正文证据（由 buildEvidence 产出）。
   * 注入时：prompt 里多一段"不可信数据块"，且 `evidenceIds` 会被当作引用白名单校验；
   * 不传或未启用时：prompt 与 P3 完全一致（既有测试不受影响）。
   */
  evidence?: EvidencePack;
}

export interface ComposePlanResult {
  plan: GeneratedPlan;
  strategy: PlanStrategy;
  /** llm = 模型生成；rule = 规则生成器兜底 */
  source: 'llm' | 'rule';
  warnings: string[];
  /** 本次 run 的轨迹 id（可在轨迹面板回看） */
  traceId: string;
  /** 引用白名单的统计（离线评测里 citation precision 就是从这里算的） */
  citations: CitationStats;
}

/**
 * 生成最终计划：
 * 1) 先用规则生成器产出基础计划（同时作为日期白名单与兜底）；
 * 2) LLM 可用时带"目标 + 澄清 + 画像 + 历史记忆 + 真实资源"请求改写；
 * 3) 任何失败 → 规则计划 + 规则策略 + 资源引用（计划始终可生成）。
 */
export async function composePlan(params: ComposePlanParams): Promise<ComposePlanResult> {
  const { input, answers, profile, resources, config, signal, now, memoryHits = [], evidence } =
    params;
  const warnings: string[] = [];
  const trace = new TraceRecorder('plan', input.goal).memory(memoryHits.map((h) => h.note.id));

  const rulePlan = generatePlan(input, now ? { now } : {});
  const minutesPerDay =
    input.preferences?.minutesPerDay ?? CATEGORY_MINUTES[rulePlan.category] ?? 60;
  const validIds = new Set(resources.items.map((r) => r.id));
  const evidenceReady = Boolean(evidence?.enabled && evidence.chunks.length > 0);

  const attach = (plan: GeneratedPlan): GeneratedPlan => ({
    ...plan,
    clarifications: answers,
    resources: resources.items,
    memoryRefs: memoryHits.map((h) => h.note.id),
    // 记录"本次模型读到了哪些正文片段"，便于 UI 展示来源与事后审计
    evidence: evidenceReady ? evidence?.chunks : undefined,
  });

  if (!config.enabled || !config.model) {
    const reason = config.enabled ? '未选择模型，已回退规则生成器' : 'AI 未开启，使用规则生成器';
    trace.fallback('plan', reason);
    const strategy = normalizeStrategy(undefined, rulePlan.category, input.days);
    const enriched = enrichPlanByRules(rulePlan, strategy, resources.items);
    const finished = trace.setLevel('rule').end();
    return {
      plan: {
        ...attach(enriched),
        strategy,
        generation: {
          source: 'rule',
          model: null,
          warnings: [reason],
          promptVersion: PROMPT_VERSION,
          traceId: finished.id,
          memoryUsed: memoryHits.length,
        },
      },
      strategy,
      source: 'rule',
      warnings: [...resources.warnings],
      traceId: finished.id,
      // 规则路径的引用由 enrichPlanByRules 直接从资源列表里取，不存在"编造"问题
      citations: { ...EMPTY_CITATION_STATS },
    };
  }

  try {
    const messages = buildPlanMessages({
      input,
      answers,
      profile,
      dates: rulePlan.days.map((d) => d.date),
      resources: resources.items,
      minutesPerDay,
      memorySection: buildMemorySection(memoryHits),
      // 未开正文抓取时不传 → prompt 与 P3 完全一致
      evidenceSection: evidenceReady ? evidence?.promptSection : undefined,
    });
    const res = await trace.measure('chat:plan', 'llm', () =>
      llmTasks.run({
        kind: 'plan',
        key: 'plan',
        timeoutMs: config.timeoutMs ?? 120_000,
        signal,
        run: (taskSignal) =>
          callChat(messages, config, { signal: taskSignal, schema: PLAN_SCHEMA }),
      }),
    );
    trace.setModel(res.model).setSchemaApplied(res.schemaApplied);
    for (const w of res.warnings) trace.warn(w);

    const raw = parsePlanV2Json(res.text);
    const availability = input.preferences?.availability ?? { start: '08:00', end: '22:00' };
    const { plan: merged, adjustments } = mergeLLMPlan(
      rulePlan,
      { narrative: raw.narrative, days: raw.days.map((d) => ({ date: d.date, tasks: d.tasks })) },
      availability,
    );
    const { plan: enriched, droppedCitations, droppedEvidence, citations } = enrichPlanWithExtras(
      merged,
      raw,
      validIds,
      evidenceIdSet(evidence),
    );
    trace.step(
      'guard:citations',
      'guard',
      0,
      droppedCitations === 0 && droppedEvidence === 0,
      `丢弃 ${droppedCitations} 处无效资源引用、${droppedEvidence} 处无效证据引用`,
    );
    if (droppedCitations > 0) {
      warnings.push(`已丢弃 ${droppedCitations} 处不在资源列表中的引用（防止编造链接）`);
    }
    if (droppedEvidence > 0) {
      warnings.push(`已丢弃 ${droppedEvidence} 处不在证据清单中的引用（防止编造依据）`);
    }
    if (evidenceReady) {
      const line = summarizeEvidence(evidence);
      if (line) warnings.push(line);
      if (evidence?.note) trace.warn(evidence.note);
    }
    warnings.push(...adjustments);

    const strategy = normalizeStrategy(raw.strategy, rulePlan.category, input.days);
    const finished = trace.end();
    return {
      plan: {
        ...attach(enriched),
        strategy,
        llmModel: config.model,
        generation: {
          source: 'llm',
          model: config.model,
          warnings: [...warnings],
          promptVersion: PROMPT_VERSION,
          traceId: finished.id,
          memoryUsed: memoryHits.length,
        },
      },
      strategy,
      source: 'llm',
      warnings: [...warnings, ...resources.warnings],
      traceId: finished.id,
      citations,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    trace.fallback('plan', reason);
    const strategy = normalizeStrategy(undefined, rulePlan.category, input.days);
    const enriched = enrichPlanByRules(rulePlan, strategy, resources.items);
    const finished = trace.end();
    return {
      plan: {
        ...attach(enriched),
        strategy,
        generation: {
          source: 'rule',
          model: null,
          warnings: [`AI 生成失败：${reason}`],
          promptVersion: PROMPT_VERSION,
          traceId: finished.id,
          memoryUsed: memoryHits.length,
        },
      },
      strategy,
      source: 'rule',
      warnings: [`AI 计划生成失败，已回退规则生成器：${reason}`, ...resources.warnings],
      traceId: finished.id,
      citations: { ...EMPTY_CITATION_STATS },
    };
  }
}

/** 资源 id -> 资源对象（UI 渲染任务引用） */
export function indexResources(items: ResourceItem[]): Map<string, ResourceItem> {
  return new Map(items.map((i) => [i.id, i]));
}

export type { NetworkingSettings };
