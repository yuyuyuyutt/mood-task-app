// src/features/plan-generator/services/agent/agents/orchestrator.ts
// Orchestrator：**确定性**的调度器（本身不调 LLM）。
//
// 一次 agentic run 的顺序与职责：
//   Clarifier（问）→ Orchestrator（自问自答并标注依据）→ Researcher（找）→ Planner（排）→ Critic（验）→ 必要时修正
//
// 三条设计原则：
//   1) **编排是代码，不是模型**：谁先谁后、失败退到哪一级，全部写死在这里，可读可测；
//   2) **每一跳都在边界处校验**：角色输出不合契约 → 该角色算失败 → 按既定规则降级，不污染下游；
//   3) **降级链**：任何角色失败都不会让整个功能不可用 ——
//      Clarifier 失败用通用问题模板；Researcher 失败退到"无资源"（计划仍能生成）；
//      Planner 失败退回规则生成器；修正轮失败则保留未修正版本并明确告知问题清单。
import type {
  ClarificationAnswer,
  ClarifyResult,
  HabitProfile,
  MemoryHit,
  NetworkingSettings,
  PlanGenInput,
  ResourceBundle,
} from '../../../types';
import { genericClarifyQuestions } from '../../clarificationService';
import { extractKeywords, type ScoreContext } from '../../resourceService';
import { parsePlanV2Json, normalizeStrategy, enrichPlanWithExtras, type ComposePlanResult } from '../../planComposer';
import { mergeLLMPlan } from '../../localLLM';
import { callChat } from '../../llm/chatClient';
import { PLAN_SCHEMA } from '../../llm/schemas';
import { llmTasks } from '../../llmTaskManager';
import { buildRepairMessages } from '../../prompts';
import { evidenceIdSet, type EvidenceFetchOptions, type EvidencePack } from '../../rag/evidence';
import type { RagRuntime } from '../../rag/hybridRetriever';
import { summarizePlanForPrompt } from '../tools/builtin/planQueryTools';
import { TraceRecorder } from '../trace';
import type { LLMConfig } from '../../llmClient';
import {
  critiquePlan,
  diffPlans,
  repairPlanByRules,
  summarizeCritique,
  type CritiqueReport,
  type PlanDiff,
} from './critic';
import {
  autoAnswerQuestions,
  makeCritiqueMessage,
  runClarifier,
  runPlanner,
  runResearcher,
  type AutoAnswer,
} from './roles';
import { makeMessage, type AgentLevel, type AgentMessage } from './protocol';

export interface AgentPlanParams {
  input: PlanGenInput;
  config: LLMConfig;
  netSettings: NetworkingSettings;
  manualResources: Parameters<typeof runResearcher>[0]['manualResources'];
  scoreContext: ScoreContext;
  profile?: HabitProfile | null;
  memoryHits?: MemoryHit[];
  rag?: { runtime: RagRuntime; goal: string };
  evidenceFetch?: EvidenceFetchOptions;
  /** 是否允许 Critic 触发模型修正轮（默认允许，最多 2 轮） */
  allowRepair?: boolean;
  signal?: AbortSignal;
  now?: Date;
}

export interface AgentRepair {
  applied: boolean;
  source: 'rule' | 'llm' | 'none';
  rounds: number;
  diff: PlanDiff;
  note?: string;
}

export interface AgentPlanRun {
  /** 本次实际走到哪一级能力（写进 trace，UI 也展示） */
  level: AgentLevel;
  /** 实际跑通的角色（用于 UI 展示"哪几个角色参与了"） */
  roles: string[];
  /** 角色之间的结构化消息（可回放每一步的输入产出） */
  messages: AgentMessage<unknown>[];
  /** 自问自答的澄清（含依据：画像 / 记忆 / 默认假设） */
  answers: AutoAnswer[];
  bundle: ResourceBundle;
  evidence: EvidencePack;
  compose: ComposePlanResult;
  critique: CritiqueReport;
  repair: AgentRepair;
  /** **编排层**轨迹 id（Planner 自己那条 trace 记在 plan.generation.traceId） */
  traceId: string;
  warnings: string[];
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function emptyBundle(): ResourceBundle {
  return {
    items: [],
    grouped: { video: [], article: [], book: [], post: [], link: [] },
    byKeyword: [],
    jumpGroups: [],
    layers: [],
    warnings: ['资源检索角色未产出结果，计划将不包含外部资源'],
  };
}

function noEvidence(reason: string): EvidencePack {
  return {
    enabled: false,
    chunks: [],
    fetched: 0,
    skipped: 0,
    embedded: 0,
    reused: 0,
    degradedReason: reason,
    promptSection: '',
  };
}

/**
 * 跑一次完整的多角色计划生成。
 * 不会抛出：所有角色失败都被捕获并落成 `warnings` + `level`，最差情况等价于"规则生成器出计划"。
 */
export async function runAgentPlan(params: AgentPlanParams): Promise<AgentPlanRun> {
  const {
    input,
    config,
    netSettings,
    manualResources,
    scoreContext,
    profile,
    memoryHits = [],
    rag,
    evidenceFetch,
    allowRepair = true,
    signal,
    now,
  } = params;

  const trace = new TraceRecorder('plan', input.goal)
    .setLevel('agent')
    .setModel(config.model || null)
    .memory(memoryHits.map((h) => h.note.id));
  const messages: AgentMessage<unknown>[] = [];
  const roles: string[] = [];
  const warnings: string[] = [];
  const minutesPerDay = input.preferences?.minutesPerDay ?? 60;
  const availability = input.preferences?.availability ?? { start: '08:00', end: '22:00' };

  // ---------------- 角色 1：Clarifier ----------------
  let clarify: ClarifyResult | null = null;
  try {
    const out = await runClarifier({
      goal: input.goal,
      days: input.days,
      userType: input.userType,
      config,
      trace,
      signal,
    });
    clarify = out.result;
    messages.push(out.message);
    roles.push('clarifier');
  } catch (err) {
    const reason = describeError(err);
    trace.fallback('agent:clarifier', reason);
    warnings.push(`澄清角色失败，已改用通用问题模板：${reason}`);
  }

  // ---------------- Orchestrator：自问自答（标注依据） ----------------
  const questions = clarify?.questions ?? genericClarifyQuestions(input.goal);
  const answers = autoAnswerQuestions({
    questions,
    profile,
    memoryHits,
    minutesPerDay,
    days: input.days,
    availability,
  });
  const assumed = answers.filter((a) => a.basis === 'default').length;
  trace.step(
    'agent:answers',
    'agent',
    0,
    true,
    `自答 ${answers.length} 问（其中 ${assumed} 条为默认假设，需用户核对）`,
  );
  messages.push(
    makeMessage({
      from: 'orchestrator',
      to: 'planner',
      type: 'clarify.answers',
      payload: { count: answers.length, assumed },
      traceId: trace.id,
    }),
  );

  const answerList: ClarificationAnswer[] = answers.map((a) => ({
    id: a.id,
    question: a.question,
    answer: a.answer,
  }));

  // ---------------- 角色 2：Researcher（关键词 + 三层检索 + 正文证据） ----------------
  let bundle: ResourceBundle = emptyBundle();
  let evidence: EvidencePack = noEvidence(
    evidenceFetch ? '正文抓取未执行' : '未开启正文抓取',
  );
  try {
    const keywordResult = await trace.measure('agent:researcher.keywords', 'llm', () =>
      extractKeywords({
        goal: input.goal,
        days: input.days,
        answers: answerList,
        userType: input.userType,
        config,
        signal,
      }),
    );
    const query =
      rag?.goal ||
      `${input.goal} ${keywordResult.keywords.map((k) => k.keyword).slice(0, 4).join(' ')}`.trim();

    const out = await runResearcher({
      keywords: keywordResult.keywords,
      settings: netSettings,
      manualResources,
      scoreContext,
      query,
      rag,
      evidenceFetch,
      trace,
      signal,
    });
    bundle = out.bundle;
    evidence = out.evidence;
    messages.push(...out.messages);
    roles.push('researcher');
  } catch (err) {
    const reason = describeError(err);
    trace.fallback('agent:researcher', reason);
    warnings.push(`资源检索角色失败，计划将不包含外部资源：${reason}`);
    evidence = noEvidence(reason);
  }

  // ---------------- 角色 3：Planner ----------------
  let compose: ComposePlanResult;
  try {
    const out = await runPlanner({
      input,
      answers: answerList,
      profile,
      bundle,
      config,
      memoryHits,
      evidence,
      trace,
      signal,
      now,
    });
    compose = out.result;
    messages.push(out.message);
    roles.push('planner');
  } catch (err) {
    // Planner 本身有规则兜底，走到这里说明是契约/schema 层失败 → 直接由上层用规则计划
    const reason = describeError(err);
    trace.fallback('agent:planner', reason);
    warnings.push(`规划角色失败：${reason}`);
    throw new Error(`Planner 失败：${reason}`);
  }

  // ---------------- 角色 4：Critic（确定性校验 + 修正） ----------------
  const validResourceIds = new Set(bundle.items.map((i) => i.id));
  const validEvidenceIds = evidenceIdSet(evidence);
  const critiqueInput = { plan: compose.plan, minutesPerDay, validResourceIds, validEvidenceIds };

  let plan = compose.plan;
  let critique: CritiqueReport;
  try {
    critique = await trace.measure('agent:critic', 'agent', async () =>
      critiquePlan(critiqueInput),
    );
    messages.push(makeCritiqueMessage(critique, trace.id));
    roles.push('critic');
  } catch (err) {
    const reason = describeError(err);
    trace.fallback('agent:critic', reason);
    warnings.push(`校验角色失败，已跳过约束校验：${reason}`);
    critique = { ok: true, checked: 0, violations: [] };
  }

  let repair: AgentRepair = {
    applied: false,
    source: 'none',
    rounds: 0,
    diff: { summary: '无需修正', changes: [] },
  };

  if (!critique.ok) {
    // (a) 确定性修正：只处理"时长超限"这类安全改动
    const ruleFix = repairPlanByRules(plan, minutesPerDay);
    if (ruleFix.changed) {
      plan = ruleFix.plan;
      repair = { applied: true, source: 'rule', rounds: 1, diff: ruleFix.diff, note: '按规则压缩时长' };
      critique = critiquePlan({ ...critiqueInput, plan });
      trace.step('agent:repair.rule', 'agent', 0, critique.ok, ruleFix.diff.summary);
    }

    // (b) 仍不通过 → 请模型做一次结构化修正（最多 2 轮，且仍需过同一套白名单）
    const canRepair = allowRepair && config.enabled && Boolean(config.model);
    for (let round = 0; round < 2 && !critique.ok && canRepair; round++) {
      try {
        const before = plan;
        const violationLines = critique.violations.map((v) => `${v.day ? `${v.day}：` : ''}${v.detail}`);
        const res = await trace.measure(`agent:repair.llm#${round + 1}`, 'llm', () =>
          llmTasks.run({
            kind: 'plan',
            key: `agent-repair-${round}`,
            timeoutMs: config.timeoutMs ?? 120_000,
            signal,
            run: (taskSignal) =>
              callChat(
                buildRepairMessages({
                  goal: input.goal,
                  planSummary: summarizePlanForPrompt(before),
                  violations: violationLines,
                  dates: before.days.map((d) => d.date),
                  minutesPerDay,
                  evidenceSection: evidence.enabled ? evidence.promptSection : undefined,
                }),
                config,
                { signal: taskSignal, schema: PLAN_SCHEMA },
              ),
          }),
        );
        trace.setSchemaApplied(res.schemaApplied);

        const raw = parsePlanV2Json(res.text);
        const merged = mergeLLMPlan(
          before,
          { narrative: raw.narrative, days: raw.days.map((d) => ({ date: d.date, tasks: d.tasks })) },
          availability,
        ).plan;
        const enriched = enrichPlanWithExtras(merged, raw, validResourceIds, validEvidenceIds).plan;
        const next = {
          ...enriched,
          strategy: normalizeStrategy(raw.strategy, plan.category, input.days),
        };
        const diff = diffPlans(before, next);
        if (diff.changes.length === 0) {
          warnings.push(`第 ${round + 1} 轮修正没有产生任何变化，已停止`);
          break;
        }
        plan = next;
        repair = {
          applied: true,
          source: 'llm',
          rounds: round + 1,
          diff,
          note: `模型修正第 ${round + 1} 轮`,
        };
        critique = critiquePlan({ ...critiqueInput, plan });
      } catch (err) {
        const reason = describeError(err);
        trace.fallback(`agent:repair.llm#${round + 1}`, reason);
        warnings.push(`模型修正失败（已保留当前版本）：${reason}`);
        break;
      }
    }
  }

  if (!critique.ok) {
    warnings.push(`仍有未解决的约束问题：${summarizeCritique(critique)}`);
  }
  trace.step(
    'agent:result',
    'agent',
    0,
    critique.ok,
    `${summarizeCritique(critique)}${repair.applied ? `；${repair.note ?? '已修正'}` : ''}`,
  );

  // ---------------- 能力级别（三级判定，写进 trace 并展示给用户） ----------------
  const plannerLlm = compose.source === 'llm';
  let level: AgentLevel;
  if (!plannerLlm) {
    level = 'rule';
  } else if (roles.length === 4) {
    level = 'multi';
  } else if (roles.includes('researcher') || roles.includes('clarifier')) {
    level = 'single';
  } else {
    level = 'pipeline';
  }
  trace.setLevel(level);

  const finished = trace.end();

  return {
    level,
    roles,
    messages,
    answers,
    bundle,
    evidence,
    // 修正后的计划以 compose.plan 为准；promptVersion / traceId 等元数据保持不变
    compose: { ...compose, plan },
    critique,
    repair,
    traceId: finished.id,
    warnings: [...warnings, ...compose.warnings],
  };
}
