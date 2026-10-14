// src/features/plan-generator/services/eval/runner.ts
// 离线评测执行器：**跑真实链路，只替换"模型"这一层**。
//
// 设计取舍（这条决定了评测值不值钱）：
//   - 不 mock 业务代码。评测调用的是生产同一套函数（clarificationService / resourceService /
//     planComposer / evidence / orchestrator / adjustPlan），只在 `globalThis.fetch` 上装一个回放桩。
//     因此"改坏了哪个环节"一定能被这条链路抓到。
//   - 不联网、不需要本地模型：脚本给什么响应就用什么响应，CI 里完全确定。
//   - 边界必须写在报告里：它衡量的是**链路与护栏**（schema 重试、白名单、降级、约束达成），
//     不衡量生成质量与语义召回质量。夸大成"模型质量评测"就是虚假陈述。
import type {
  ClarificationAnswer,
  NetworkingSettings,
  ResourceBundle,
  SearchKeyword,
  UserType,
} from '../../types';
import { DEFAULT_LLM_CONFIG, type LLMConfig } from '../llmClient';
import { generateClarifyingQuestions } from '../clarificationService';
import { collectResources, extractKeywords, hashString, type ScoreContext } from '../resourceService';
import { composePlan, type ComposePlanResult } from '../planComposer';
import { generatePlan } from '../planGenerator';
import { buildQueryText } from '../rag/embedding';
import { buildEvidence, evidenceIdSet, type EvidencePack } from '../rag/evidence';
import { buildRagRuntime } from '../rag/hybridRetriever';
import { InMemoryVectorBackend } from '../rag/inMemoryVectorBackend';
import { VectorStore } from '../rag/vectorStore';
import { matchManualResources } from '../resources/searxngSource';
import { critiquePlan, type CritiqueReport } from '../agent/agents/critic';
import { runAgentPlan } from '../agent/agents/orchestrator';
import { adjustPlan, commitAdjust } from '../agent/adjustPlan';
import { traceStore, type AgentRunTrace } from '../agent/trace';
import { EVAL_CASES } from './cases';
import { mean, percentile, precision, rate, round3, safeRatio } from './metrics';
import { installReplayFetch, type ReplayHandle } from './replay';
import type {
  AggregateMetrics,
  CaseObservation,
  EvalCase,
  EvalCaseResult,
  EvalReport,
  EvalThresholds,
  ScriptedContext,
} from './types';

/** 评测固定"现在"：保证日期白名单（从而脚本里的日期）在任何机器上都一致 */
export const EVAL_NOW = new Date('2026-09-28T12:00:00');

/** 评测用的模型配置：enabled=true 让链路走"模型路径"，实际响应由回放桩给出 */
export const EVAL_CONFIG: LLMConfig = {
  ...DEFAULT_LLM_CONFIG,
  enabled: true,
  model: 'eval-replay-model',
  timeoutMs: 5_000,
};

/** 离线环境没有真实 embedding 模型：用回放层的哈希词袋伪向量（见 replay.ts 说明） */
export const EVAL_EMBEDDING_MODEL = 'eval-pseudo-embedding';

/** 汇总门禁：低于这些值视为回归。数值刻意留了一点余量，避免"改一句文案就红"。 */
export const DEFAULT_EVAL_THRESHOLDS: EvalThresholds = {
  passRate: 1,
  schemaPassRate: 0.75,
  maxDegradationRate: 0.3,
  citationPrecision: 0.8,
  constraintRate: 1,
  toolSuccessRate: 1,
};

const DEFAULT_SETTINGS: NetworkingSettings = {
  bilibili: false,
  searxng: false,
  searxngBaseUrl: '',
  searxngEngines: [],
  jumpLinks: false,
  timeoutMs: 1_000,
  preferredDifficulty: 'unknown',
};

const SCORE_CONTEXT: ScoreContext = { preferredDifficulty: 'unknown' };

function settingsFor(c: EvalCase): NetworkingSettings {
  return { ...DEFAULT_SETTINGS, ...(c.settings ?? {}) };
}

function minutesOf(c: EvalCase): number {
  return c.minutesPerDay ?? 60;
}

function inputOf(c: EvalCase) {
  return {
    goal: c.goal,
    days: c.days,
    planType: c.planType ?? ('tasks' as const),
    userType: (c.userType ?? 'balanced') as UserType,
    preferences: {
      style: 'auto' as const,
      availability: { start: '08:00', end: '22:00' },
      minutesPerDay: minutesOf(c),
      includeWeekend: true,
    },
  };
}

/** 本次 run 的日期白名单：与 composePlan 内部用的规则生成器同源，保证脚本能写对日期 */
export function caseDates(c: EvalCase): string[] {
  return generatePlan(inputOf(c), { now: EVAL_NOW }).days.map((d) => d.date);
}

/** 用例声明的本地资源库里，会被关键词命中的资源 id（用于脚本构造"合法引用"） */
export function matchedResourceIds(c: EvalCase, keywords: SearchKeyword[]): string[] {
  const ids = new Set<string>();
  for (const kw of keywords) {
    for (const item of matchManualResources(c.manualResources ?? [], kw.keyword, hashString)) {
      ids.add(item.id);
    }
  }
  return [...ids];
}

function newVectorStore(): VectorStore {
  return new VectorStore(new InMemoryVectorBackend());
}

function ragRuntime() {
  return buildRagRuntime(
    { baseUrl: 'replay://eval' },
    { model: EVAL_EMBEDDING_MODEL, timeoutMs: 5_000 },
    newVectorStore(),
  );
}

/** 收集本次用例产生的轨迹（traceStore.record 是前插，用 id 差集即可，不受容量淘汰影响） */
function tracesAfter(before: Set<string>): AgentRunTrace[] {
  return traceStore.list().filter((t) => !before.has(t.id));
}

function observationFromTraces(
  traces: AgentRunTrace[],
): Pick<CaseObservation, 'fallbacks' | 'fallbackStages' | 'steps' | 'ms' | 'schemaApplied' | 'warnings'> {
  const fallbacks = traces.flatMap((t) => t.fallbacks);
  const planTrace = traces.find((t) => t.kind === 'plan');
  return {
    fallbacks: fallbacks.length,
    fallbackStages: [...new Set(fallbacks.map((f) => f.stage))],
    steps: traces.reduce((sum, t) => sum + t.steps.length, 0),
    ms: traces.reduce((sum, t) => sum + (t.ms ?? 0), 0),
    schemaApplied: planTrace ? planTrace.schemaApplied ?? null : null,
    warnings: traces.flatMap((t) => t.warnings),
  };
}

function toolStats(traces: AgentRunTrace[]): { total: number; ok: number } {
  const calls = traces.flatMap((t) => t.toolCalls);
  return { total: calls.length, ok: calls.filter((c) => c.ok).length };
}

function violationTexts(report: CritiqueReport): string[] {
  return report.violations.map((v) => `${v.severity}:${v.type}${v.day ? `@${v.day}` : ''} ${v.detail}`);
}

function replayCounts(replay: ReplayHandle): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const call of replay.calls) counts[call.kind] = (counts[call.kind] ?? 0) + 1;
  return counts;
}

/** 按用例声明的期望逐条核对；返回人话描述的失败清单 */
function checkExpectations(c: EvalCase, obs: CaseObservation): string[] {
  const failures: string[] = [];
  const e = c.expect;
  const expectAtLeast = (label: string, actual: number, min: number | undefined) => {
    if (min === undefined) return;
    if (actual < min) failures.push(`${label}：期望 ≥ ${min}，实际 ${actual}`);
  };
  const expectAtMost = (label: string, actual: number, max: number | undefined) => {
    if (max === undefined) return;
    if (actual > max) failures.push(`${label}：期望 ≤ ${max}，实际 ${actual}`);
  };

  if (e.source && obs.source !== e.source) {
    failures.push(`计划来源：期望 ${e.source}，实际 ${obs.source}`);
  }
  expectAtMost('降级次数', obs.fallbacks, e.maxFallbacks);
  if (e.minCitationPrecision !== undefined && obs.citationPrecision < e.minCitationPrecision) {
    failures.push(
      `引用精度：期望 ≥ ${e.minCitationPrecision}，实际 ${obs.citationPrecision}（保留 ${obs.citations.resourcesKept + obs.citations.evidenceKept}，丢弃 ${obs.citations.resourcesDropped + obs.citations.evidenceDropped}）`,
    );
  }
  expectAtLeast('被丢弃的资源引用', obs.citations.resourcesDropped, e.minDroppedCitations);
  expectAtLeast('被丢弃的证据引用', obs.citations.evidenceDropped, e.minDroppedEvidence);
  if (e.minConstraintRate !== undefined) {
    const actual = obs.constraintsOk ? 1 : 0;
    if (actual < e.minConstraintRate) {
      failures.push(`约束达成：期望 ≥ ${e.minConstraintRate}，实际 ${actual}（${obs.violations.join('；')}）`);
    }
  }
  expectAtLeast('正文证据块数', obs.evidenceChunks, e.minEvidence);
  if (e.days !== undefined && obs.planDays !== e.days) {
    failures.push(`计划天数：期望 ${e.days}，实际 ${obs.planDays}`);
  }
  if (e.schemaApplied !== undefined && obs.schemaApplied !== e.schemaApplied) {
    failures.push(`schema 是否被接受：期望 ${e.schemaApplied}，实际 ${obs.schemaApplied}`);
  }
  if (e.level && obs.level !== e.level) {
    failures.push(`能力级别：期望 ${e.level}，实际 ${obs.level ?? '未记录'}`);
  }
  expectAtLeast('跑通的角色数', obs.roles.length, e.minRoles);
  expectAtLeast('成功的工具调用数', obs.toolCalls.ok, e.toolCallsOk);
  if (e.toolCommitted !== undefined && obs.toolCommitted !== e.toolCommitted) {
    failures.push(`确认令牌提交结果：期望 ${e.toolCommitted}，实际 ${obs.toolCommitted ?? '未记录'}`);
  }

  return failures;
}

interface PipelineRun {
  compose: ComposePlanResult;
  bundle: ResourceBundle;
  evidence: EvidencePack;
  critique: CritiqueReport;
  traces: AgentRunTrace[];
}

/**
 * 跑"澄清 → 关键词 → 三层检索（含语义重排）→ 正文证据 → 计划生成 + 约束校验"这条真实管线。
 * pipeline 与 adjust 两种模式共用它：adjust 需要一份**真实计划**当夹具，
 * 共用同一个入口可以避免两套代码各自漂移（那会让评测结论互相矛盾）。
 */
async function runPipeline(
  c: EvalCase,
  scriptCtx: ScriptedContext,
  before: Set<string>,
): Promise<PipelineRun> {
  const input = inputOf(c);
  const runtime = ragRuntime();
  const allowed = c.allowedDomains ?? [];

  const clarify = await generateClarifyingQuestions({
    goal: c.goal,
    days: c.days,
    userType: input.userType,
    config: EVAL_CONFIG,
  });
  const answers: ClarificationAnswer[] = clarify.questions.map((q) => ({
    id: q.id,
    question: q.question,
    answer: `每天 ${minutesOf(c)} 分钟，先补基础`,
  }));
  const keywordResult = await extractKeywords({
    goal: c.goal,
    days: c.days,
    answers,
    userType: input.userType,
    config: EVAL_CONFIG,
  });
  const bundle = await collectResources({
    keywords: keywordResult.keywords,
    settings: settingsFor(c),
    manualResources: c.manualResources ?? [],
    scoreContext: SCORE_CONTEXT,
    rag: { runtime, goal: c.goal },
  });
  // 把"哪些资源 id 是合法的"回填给脚本 —— 脚本只有知道了才能构造出合法引用
  scriptCtx.resourceIds = [
    ...new Set([...matchedResourceIds(c, keywordResult.keywords), ...bundle.items.map((i) => i.id)]),
  ];
  const evidence = await buildEvidence({
    items: bundle.items,
    query: buildQueryText(c.goal, keywordResult.keywords),
    runtime,
    fetch: {
      enabled: allowed.length > 0,
      allowedDomains: allowed,
      maxResources: 1,
      maxChunks: 2,
      timeoutMs: 3_000,
    },
  });
  const compose = await composePlan({
    input,
    answers,
    profile: null,
    resources: bundle,
    config: EVAL_CONFIG,
    now: EVAL_NOW,
    memoryHits: [],
    evidence,
  });
  const critique = critiquePlan({
    plan: compose.plan,
    minutesPerDay: minutesOf(c),
    validResourceIds: new Set(bundle.items.map((i) => i.id)),
    validEvidenceIds: evidenceIdSet(evidence),
  });
  return { compose, bundle, evidence, critique, traces: tracesAfter(before) };
}

/** 跑一条用例（永不抛出：异常被捕获成 `error` 字段，这样一条用例崩了不会中断整轮评测） */
export async function runEvalCase(c: EvalCase): Promise<EvalCaseResult> {
  const mode = c.mode ?? 'pipeline';
  const before = new Set(traceStore.list().map((t) => t.id));
  let replay: ReplayHandle | null = null;
  let observation: CaseObservation | null = null;

  try {
    const input = inputOf(c);
    const dates = caseDates(c);
    const scriptCtx: ScriptedContext = {
      goal: c.goal,
      days: c.days,
      minutesPerDay: minutesOf(c),
      dates,
      resourceIds: [],
    };
    replay = installReplayFetch(c.script, scriptCtx);

    if (mode === 'adjust') {
      // 先在真实管线上产出一份**完整计划**（含策略与引用），再对它做调整 ——
      // 直接拿规则骨架当夹具会缺策略风险，测的就不是真实路径了。
      const pipeline = await runPipeline(c, scriptCtx, before);
      const plan = pipeline.compose.plan;
      const result = await adjustPlan({
        instruction: c.instruction ?? '整周顺延 2 天',
        plan,
        config: EVAL_CONFIG,
        now: EVAL_NOW,
      });
      let committed = false;
      let committedPlan = plan;
      if (result.status === 'ok') {
        const res = await commitAdjust(result.gate, result.token, plan);
        committed = res.ok === true;
        if (res.plan) committedPlan = res.plan;
      }
      const critique = critiquePlan({
        plan: committedPlan,
        minutesPerDay: minutesOf(c),
        validResourceIds: new Set(pipeline.bundle.items.map((i) => i.id)),
        validEvidenceIds: evidenceIdSet(pipeline.evidence),
      });
      const traces = tracesAfter(before);
      observation = {
        mode,
        source: pipeline.compose.source,
        roles: ['clarifier', 'researcher', 'planner', 'critic'],
        evidenceChunks: pipeline.evidence.chunks.length,
        citations: pipeline.compose.citations,
        citationPrecision: precision(
          pipeline.compose.citations.resourcesKept + pipeline.compose.citations.evidenceKept,
          pipeline.compose.citations.resourcesDropped + pipeline.compose.citations.evidenceDropped,
        ),
        constraintsOk: critique.ok,
        violations: violationTexts(critique),
        strategyRisks: committedPlan.strategy?.risks.length ?? 0,
        planDays: committedPlan.days.length,
        toolCommitted: committed,
        toolCalls: toolStats(traces),
        ...observationFromTraces(traces),
        replayCalls: replayCounts(replay),
      };
    } else if (mode === 'agent') {
      const runtime = ragRuntime();
      const allowed = c.allowedDomains ?? [];
      const run = await runAgentPlan({
        input,
        config: EVAL_CONFIG,
        netSettings: settingsFor(c),
        manualResources: c.manualResources ?? [],
        scoreContext: SCORE_CONTEXT,
        profile: null,
        memoryHits: [],
        rag: { runtime, goal: c.goal },
        evidenceFetch: {
          enabled: allowed.length > 0,
          allowedDomains: allowed,
          maxResources: 1,
          maxChunks: 2,
          timeoutMs: 3_000,
        },
        now: EVAL_NOW,
      });
      scriptCtx.resourceIds = run.bundle.items.map((i) => i.id);
      observation = {
        mode,
        source: run.compose.source,
        level: run.level,
        roles: run.roles,
        evidenceChunks: run.evidence.chunks.length,
        citations: run.compose.citations,
        citationPrecision: precision(
          run.compose.citations.resourcesKept + run.compose.citations.evidenceKept,
          run.compose.citations.resourcesDropped + run.compose.citations.evidenceDropped,
        ),
        constraintsOk: run.critique.ok,
        violations: run.critique.violations.map((v) => `${v.severity}:${v.type} ${v.detail}`),
        strategyRisks: run.compose.plan.strategy?.risks.length ?? 0,
        planDays: run.compose.plan.days.length,
        toolCalls: { total: 0, ok: 0 },
        ...observationFromTraces(tracesAfter(before)),
        replayCalls: replayCounts(replay),
      };
    } else {
      const pipeline = await runPipeline(c, scriptCtx, before);
      const traces = pipeline.traces;
      observation = {
        mode,
        source: pipeline.compose.source,
        roles: ['researcher', 'planner', 'critic'],
        evidenceChunks: pipeline.evidence.chunks.length,
        citations: pipeline.compose.citations,
        citationPrecision: precision(
          pipeline.compose.citations.resourcesKept + pipeline.compose.citations.evidenceKept,
          pipeline.compose.citations.resourcesDropped + pipeline.compose.citations.evidenceDropped,
        ),
        constraintsOk: pipeline.critique.ok,
        violations: violationTexts(pipeline.critique),
        strategyRisks: pipeline.compose.plan.strategy?.risks.length ?? 0,
        planDays: pipeline.compose.plan.days.length,
        toolCalls: toolStats(traces),
        ...observationFromTraces(traces),
        replayCalls: replayCounts(replay),
      };
    }
  } catch (err) {
    return {
      caseId: c.id,
      title: c.title,
      rationale: c.rationale,
      mode,
      passed: false,
      failures: [],
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    replay?.restore();
  }

  const failures = checkExpectations(c, observation);
  return {
    caseId: c.id,
    title: c.title,
    rationale: c.rationale,
    mode,
    passed: failures.length === 0,
    failures,
    observation,
  };
}

/** 对抗用例：故意让模型编造引用，期望值是"必须被丢弃"。它们不参与引用精度的汇总。 */
export function isAdversarialCase(c: EvalCase): boolean {
  return (
    (c.expect.minDroppedCitations ?? 0) > 0 || (c.expect.minDroppedEvidence ?? 0) > 0
  );
}

function aggregate(results: EvalCaseResult[], cases: EvalCase[]): AggregateMetrics {
  const observations = results
    .map((r) => r.observation)
    .filter((o): o is CaseObservation => Boolean(o));

  const schemaSamples = observations
    .filter((o) => o.schemaApplied !== null)
    .map((o) => o.schemaApplied === true);

  const cleanObservations = results
    .filter((r) => {
      const c = cases.find((item) => item.id === r.caseId);
      return Boolean(r.observation) && c !== undefined && !isAdversarialCase(c);
    })
    .map((r) => r.observation as CaseObservation);

  const kept = cleanObservations.reduce(
    (sum, o) => sum + o.citations.resourcesKept + o.citations.evidenceKept,
    0,
  );
  const dropped = cleanObservations.reduce(
    (sum, o) => sum + o.citations.resourcesDropped + o.citations.evidenceDropped,
    0,
  );

  const evidenceCases = results.filter((_, i) => (cases[i]?.expect.minEvidence ?? 0) > 0);
  const evidenceOk = evidenceCases.filter(
    (r) => (r.observation?.evidenceChunks ?? 0) >= (cases.find((c) => c.id === r.caseId)?.expect.minEvidence ?? 1),
  );

  const totalToolCalls = observations.reduce((sum, o) => sum + o.toolCalls.total, 0);
  const okToolCalls = observations.reduce((sum, o) => sum + o.toolCalls.ok, 0);

  return {
    caseCount: results.length,
    adversarialCaseCount: cases.filter(isAdversarialCase).length,
    passRate: round3(rate(results.map((r) => r.passed))),
    schemaPassRate: round3(rate(schemaSamples)),
    degradationRate: round3(rate(observations.map((o) => o.fallbacks > 0))),
    citationPrecision: round3(precision(kept, dropped)),
    constraintRate: round3(rate(observations.map((o) => o.constraintsOk))),
    evidenceCoverage: round3(safeRatio(evidenceOk.length, evidenceCases.length, 1)),
    toolSuccessRate: round3(safeRatio(okToolCalls, totalToolCalls, 1)),
    meanSteps: round3(mean(observations.map((o) => o.steps))),
    p95LatencyMs: round3(percentile(observations.map((o) => o.ms), 95)),
  };
}

function thresholdFailures(metrics: AggregateMetrics, t: EvalThresholds): string[] {
  const failures: string[] = [];
  const atLeast = (label: string, actual: number, min: number) => {
    if (actual < min) failures.push(`${label}：期望 ≥ ${min}，实际 ${actual}`);
  };
  atLeast('用例通过率', metrics.passRate, t.passRate);
  atLeast('schema 通过率', metrics.schemaPassRate, t.schemaPassRate);
  atLeast('引用精度', metrics.citationPrecision, t.citationPrecision);
  atLeast('约束达成率', metrics.constraintRate, t.constraintRate);
  atLeast('工具成功率', metrics.toolSuccessRate, t.toolSuccessRate);
  if (metrics.degradationRate > t.maxDegradationRate) {
    failures.push(`降级用例比例：期望 ≤ ${t.maxDegradationRate}，实际 ${metrics.degradationRate}`);
  }
  return failures;
}

const REPORT_NOTES = [
  '评测跑的是**生产同一套代码**，只把"模型"这一层换成脚本回放，因此链路回归一定能被捕获。',
  '不联网、不需要本地模型：结果在任何机器上确定（评测里的"模型"是脚本，不是真模型）。',
  '边界：它衡量**链路与护栏**（schema 重试 / 引用白名单 / 降级链 / 约束达成 / 令牌提交），',
  '      不衡量生成质量与语义召回质量 —— 后者需要真模型 + 人工评分，不进 CI。',
  '离线环境的向量是哈希词袋伪向量（确定性），足以验证检索链路，不代表真实语义效果。',
];

export interface RunEvalOptions {
  cases?: EvalCase[];
  thresholds?: EvalThresholds;
}

/** 跑整套评测并给出带门禁结论的报告 */
export async function runEvalSuite(options: RunEvalOptions = {}): Promise<EvalReport> {
  const cases = options.cases ?? EVAL_CASES;
  const thresholds = options.thresholds ?? DEFAULT_EVAL_THRESHOLDS;

  const results: EvalCaseResult[] = [];
  for (const c of cases) {
    results.push(await runEvalCase(c));
  }

  const metrics = aggregate(results, cases);
  const failures = thresholdFailures(metrics, thresholds);
  for (const r of results) {
    if (!r.passed) {
      const detail = r.error ? `运行异常：${r.error}` : r.failures.join('；');
      failures.push(`[${r.caseId}] ${r.title} —— ${detail}`);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    cases: results,
    metrics,
    thresholds,
    ok: failures.length === 0,
    failures,
    notes: REPORT_NOTES,
  };
}
