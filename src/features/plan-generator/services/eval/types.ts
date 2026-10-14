// src/features/plan-generator/services/eval/types.ts
// 离线评测的类型定义。
//
// 评测的基本单位是「用例（case）」：一段**脚本化的模型响应** + 一组**可判定的期望**。
// 脚本化是关键 —— 评测不联网、不依赖本地模型，因此在 CI 里可重复、可回归；
// 代价是它衡量的是"链路与护栏"，不是"模型生成质量"（后者需要真模型 + 人工评分，
// 那属于另一个维度的评测，本模块在报告里明确标注了这个边界）。
import type { NetworkingSettings, PlanGenInput, ManualResource, UserType } from '../../types';
import type { TraceLevel } from '../agent/trace';
import type { CitationStats } from '../planComposer';

/** 脚本上下文：让脚本能引用运行期才知道的信息（例如本次的日期白名单） */
export interface ScriptedContext {
  goal: string;
  days: number;
  minutesPerDay: number;
  /** 本次 run 的日期白名单（与 generatePlan 一致） */
  dates: string[];
  /** 本次可用的合法资源 id（来自 manualResources 的匹配结果） */
  resourceIds: string[];
}

export type ScriptedText = string | ((ctx: ScriptedContext) => string);

/** 一条脚本化的响应：要么给出文本，要么给出一个 HTTP 错误（用来测降级） */
export type ScriptedResponse = { text: ScriptedText } | { status: number; body?: string };

/** 正文抓取的夹具：URL 前缀 -> HTML */
export type EvalPageFixtures = Record<string, string>;

export interface EvalScript {
  /** 阶段 1：澄清问题（按调用顺序消费；只剩一条时重复使用） */
  clarify?: ScriptedResponse[];
  /** 阶段 2：检索关键词 */
  keywords?: ScriptedResponse[];
  /** 阶段 3：计划（多轮时按顺序消费，末条重复） */
  plan?: ScriptedResponse[];
  /** adjust 模式：模型的工具调用决策 */
  toolCall?: ScriptedResponse[];
  /** 正文抓取夹具（只有白名单域名会被真正请求到） */
  pages?: EvalPageFixtures;
}

/** 评测模式：固定管线 / 多角色协作 / 单步工具调用 */
export type EvalMode = 'pipeline' | 'agent' | 'adjust';

export interface EvalExpectations {
  /** 期望计划来源 */
  source?: 'llm' | 'rule';
  /** 允许的降级次数上限（默认 0：期望链路干净） */
  maxFallbacks?: number;
  /** citation precision 下限（默认 0.8） */
  minCitationPrecision?: number;
  /** 至少被白名单丢弃几条资源引用（用来证明"护栏真的拦住了编造"） */
  minDroppedCitations?: number;
  /** 至少被白名单丢弃几条证据引用 */
  minDroppedEvidence?: number;
  /** 期望计划阶段的 schema 是否被服务端接受（false = 期望发生过降级重试） */
  schemaApplied?: boolean;
  /** 约束达成率下限（默认 1，即 Critic 全部通过） */
  minConstraintRate?: number;
  /** 期望至少命中的正文证据块数（默认 0） */
  minEvidence?: number;
  /** 期望计划天数 */
  days?: number;
  /** agent 模式：期望的能力级别 */
  level?: TraceLevel;
  /** agent 模式：期望至少跑通几个角色 */
  minRoles?: number;
  /** adjust 模式：期望成功的工具调用数（默认 1） */
  toolCallsOk?: number;
  /** adjust 模式：确认令牌提交后，计划是否必须真的发生变化 */
  toolCommitted?: boolean;
}

export interface EvalCase {
  id: string;
  title: string;
  /** 这条用例想守住什么产品行为（打印在报告里，让人看懂"为什么有这条"） */
  rationale: string;
  mode?: EvalMode;
  goal: string;
  days: number;
  userType?: UserType;
  minutesPerDay?: number;
  planType?: PlanGenInput['planType'];
  /** 资源与联网设置（默认全部关闭，只用本地资源库） */
  settings?: Partial<NetworkingSettings>;
  /** 本地资源库条目：既作为检索结果，也作为引用的合法 id 来源 */
  manualResources?: ManualResource[];
  /** 允许抓取正文的域名（给 buildEvidence 用；留空 = 不抓） */
  allowedDomains?: string[];
  /** adjust 模式：待调整的计划与用户指令 */
  instruction?: string;
  script: EvalScript;
  expect: EvalExpectations;
}

// ---------------- 运行结果与报告 ----------------

/** 一次用例运行里"可被断言"的全部事实 */
export interface CaseObservation {
  mode: EvalMode;
  source: 'llm' | 'rule';
  level?: TraceLevel;
  roles: string[];
  /** 降级次数（trace.fallbacks 汇总） */
  fallbacks: number;
  fallbackStages: string[];
  warnings: string[];
  citations: CitationStats;
  /** 引用精度 = 通过白名单的引用 /（通过 + 被丢弃） */
  citationPrecision: number;
  constraintsOk: boolean;
  violations: string[];
  evidenceChunks: number;
  /** 轨迹步数（越多代表链路越长，异常膨胀是坏味道） */
  steps: number;
  ms: number;
  /** 回放层记录到的各类请求次数（用于发现"意外的网络依赖"） */
  replayCalls: Record<string, number>;
  /** 计划阶段是否成功把 JSON Schema 交给服务端（null = 没发生过该调用） */
  schemaApplied: boolean | null;
  strategyRisks: number;
  planDays: number;
  toolCalls: { total: number; ok: number };
  /** adjust 模式：确认令牌提交后计划是否真的发生了变化 */
  toolCommitted?: boolean;
}

export interface EvalCaseResult {
  caseId: string;
  title: string;
  rationale: string;
  mode: EvalMode;
  passed: boolean;
  /** 未满足的期望（每条都是"哪条期望、期望什么、实际什么"） */
  failures: string[];
  /** 运行期异常（脚本缺响应、链路抛错等） */
  error?: string;
  observation?: CaseObservation;
}

export interface AggregateMetrics {
  caseCount: number;
  /** 对抗用例数（故意让模型编造引用，期望被白名单拦住） */
  adversarialCaseCount: number;
  passRate: number;
  /** 计划阶段 schema 一次通过率（只统计真正发生过该调用的用例） */
  schemaPassRate: number;
  /** 出现任何降级的用例比例 */
  degradationRate: number;
  /**
   * 引用精度（**只统计非对抗用例**）。
   * 对抗用例的存在就是为了"精度低"，把它们混进来会让这个指标失去意义；
   * 对抗用例的期望由各自的 `minDroppedCitations` / `minDroppedEvidence` 单独断言。
   */
  citationPrecision: number;
  constraintRate: number;
  /** 期望证据的用例里，真正拿到证据的比例 */
  evidenceCoverage: number;
  toolSuccessRate: number;
  meanSteps: number;
  p95LatencyMs: number;
}

export interface EvalThresholds {
  passRate: number;
  schemaPassRate: number;
  maxDegradationRate: number;
  citationPrecision: number;
  constraintRate: number;
  toolSuccessRate: number;
}

export interface EvalReport {
  generatedAt: string;
  cases: EvalCaseResult[];
  metrics: AggregateMetrics;
  thresholds: EvalThresholds;
  /** 汇总门禁是否通过 */
  ok: boolean;
  /** 未达标的汇总项 + 失败用例说明 */
  failures: string[];
  /** 本次评测的能力边界说明（报告里必须带上，避免被误读成"模型质量评测"） */
  notes: string[];
}
