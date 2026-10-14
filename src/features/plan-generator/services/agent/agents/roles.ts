// src/features/plan-generator/services/agent/agents/roles.ts
// 三个 specialist 的**薄封装** + 澄清问题的自动作答。
//
// 这一层刻意写得很薄：每个角色只做三件事——
//   1) 调用既有的能力模块（clarificationService / resourceService / planComposer），不重复造轮子；
//   2) 把结果包成结构化 `AgentMessage`，并**在边界处过 zod**（不合契约就抛错，由编排器降级）；
//   3) 往 trace 里记一步（角色名 / 耗时 / 成败 / 一句话产出）。
//
// 换句话说：多角色协作的"智能"来自分工与校验，而不是把逻辑再抄一遍。
import type {
  ClarificationAnswer,
  ClarifyResult,
  HabitProfile,
  ManualResource,
  MemoryHit,
  NetworkingSettings,
  PlanGenInput,
  ResourceBundle,
  SearchKeyword,
  UserType,
} from '../../../types';
import { generateClarifyingQuestions } from '../../clarificationService';
import { collectResources, type ScoreContext } from '../../resourceService';
import { composePlan, type ComposePlanResult } from '../../planComposer';
import { buildEvidence, type EvidenceFetchOptions, type EvidencePack } from '../../rag/evidence';
import type { RagRuntime } from '../../rag/hybridRetriever';
import type { LLMConfig } from '../../llmClient';
import type { TraceRecorder } from '../trace';
import {
  clarifyPayloadSchema,
  critiquePayloadSchema,
  evidencePayloadSchema,
  makeMessage,
  planPayloadSchema,
  validatePayload,
  type AgentMessage,
} from './protocol';

// ---------------- 自动作答（Clarifier 的"自问自答"） ----------------

export interface AutoAnswer extends ClarificationAnswer {
  /** 依据来源：画像 / 记忆 / 默认假设 */
  basis: 'profile' | 'memory' | 'default';
}

export interface AutoAnswerParams {
  questions: Array<{ id: string; question: string; dimension?: string }>;
  profile?: HabitProfile | null;
  memoryHits?: MemoryHit[];
  minutesPerDay: number;
  days: number;
  availability: { start: string; end: string };
}

/**
 * 用本地已有的事实回答澄清问题，**并把依据标注出来**。
 *
 * 为什么不叫模型来答：澄清问题问的是"用户的情况"，模型只能猜。
 * 有依据就用（画像 / 记忆），没有依据就明确写成"按保守假设"，
 * 让用户在 UI 里看到哪些是假设、可以改 —— 这比编一段自信的回答安全得多。
 */
export function autoAnswerQuestions(params: AutoAnswerParams): AutoAnswer[] {
  const { questions, profile, memoryHits = [], minutesPerDay, days, availability } = params;
  const features = profile?.features;
  const completionRate =
    typeof features?.completionRate === 'number' ? Math.round(features.completionRate * 100) : null;
  const avgDuration = features?.avgTaskDurationMinutes ?? null;
  const peakHour = features?.peakCompletionHour ?? null;
  const memory = memoryHits[0]?.note;

  const match = (text: string, keys: string[]): boolean => keys.some((k) => text.includes(k));

  return questions.map((q) => {
    const text = `${q.dimension ?? ''}${q.question}`;

    if (match(text, ['基础', '目前', '现状', '已经会'])) {
      if (completionRate !== null) {
        return {
          id: q.id,
          question: q.question,
          answer: `凭本地画像：过去任务完成率约 ${completionRate}%，说明当前节奏${
            completionRate >= 70 ? '可以承受' : '偏紧，需要更小的起步任务'
          }。请按这个基准安排。`,
          basis: 'profile' as const,
        };
      }
      return {
        id: q.id,
        question: q.question,
        answer: '（按保守假设）按零基础起步，前几天先安排熟悉概念与环境的短任务。',
        basis: 'default' as const,
      };
    }

    if (match(text, ['时间', '投入', '每天', '时长', '约束', '设备', '预算'])) {
      return {
        id: q.id,
        question: q.question,
        answer: `每天可投入约 ${minutesPerDay} 分钟，可用时段 ${availability.start}–${availability.end}。`,
        basis: 'profile' as const,
      };
    }

    if (match(text, ['偏好', '风格', '喜欢', '方式', '视频', '读书'])) {
      if (peakHour !== null) {
        return {
          id: q.id,
          question: q.question,
          answer: `凭本地画像：你在 ${String(peakHour).padStart(2, '0')}:00 前后完成率最高，优先把难点放在这个时段。`,
          basis: 'profile' as const,
        };
      }
      return {
        id: q.id,
        question: q.question,
        answer: '（按保守假设）以短时高频的方式推进，难点任务拆小后再做。',
        basis: 'default' as const,
      };
    }

    if (match(text, ['目标', '程度', '标准', '达成', '验证'])) {
      if (memory) {
        const rate = memory.stats?.completionRate;
        return {
          id: q.id,
          question: q.question,
          answer: `参考你上次类似目标（${memory.subject}）${memory.summary}${
            typeof rate === 'number' ? '' : ''
          }；本次按 ${days} 天内产出可见成果、完成率不低于 70% 设定。`,
          basis: 'memory' as const,
        };
      }
      return {
        id: q.id,
        question: q.question,
        answer: `（按保守假设）以 ${days} 天内完成一轮完整练习、每天完成率不低于 70% 作为达成标准。`,
        basis: 'default' as const,
      };
    }

    if (avgDuration !== null && match(text, ['耗时', '任务大小', '颗粒'])) {
      return {
        id: q.id,
        question: q.question,
        answer: `凭本地画像：你的平均任务耗时约 ${avgDuration} 分钟，单任务按这个粒度安排。`,
        basis: 'profile' as const,
      };
    }

    return {
      id: q.id,
      question: q.question,
      answer: '（按保守假设）按常规节奏推进，先易后难。',
      basis: 'default' as const,
    };
  });
}

// ---------------- 角色 1：Clarifier ----------------

export interface ClarifierParams {
  goal: string;
  days: number;
  userType: UserType;
  config: LLMConfig;
  trace: TraceRecorder;
  signal?: AbortSignal;
}

export interface ClarifierOutput {
  message: AgentMessage<{ questions: number; source: string }>;
  result: ClarifyResult;
}

export async function runClarifier(params: ClarifierParams): Promise<ClarifierOutput> {
  const { goal, days, userType, config, trace, signal } = params;
  const result = await trace.measure('agent:clarifier', 'agent', () =>
    generateClarifyingQuestions({ goal, days, userType, config, signal }),
  );

  const payload = {
    questions: result.questions.map((q) => ({ id: q.id, question: q.question })),
    source: result.source,
  };
  const checked = validatePayload(clarifyPayloadSchema, payload);
  if (!checked.ok) throw new Error(`Clarifier 输出不符合契约：${checked.error}`);

  return {
    result,
    message: makeMessage({
      from: 'clarifier',
      to: 'orchestrator',
      type: 'clarify.questions',
      payload: { questions: result.questions.length, source: result.source },
      traceId: trace.id,
    }),
  };
}

// ---------------- 角色 2：Researcher ----------------

export interface ResearcherParams {
  keywords: SearchKeyword[];
  settings: NetworkingSettings;
  manualResources: ManualResource[];
  scoreContext: ScoreContext;
  query: string;
  rag?: { runtime: RagRuntime; goal: string };
  evidenceFetch?: EvidenceFetchOptions;
  trace: TraceRecorder;
  signal?: AbortSignal;
}

export interface ResearcherOutput {
  messages: Array<AgentMessage<unknown>>;
  bundle: ResourceBundle;
  evidence: EvidencePack;
}

export async function runResearcher(params: ResearcherParams): Promise<ResearcherOutput> {
  const { keywords, settings, manualResources, scoreContext, query, rag, evidenceFetch, trace, signal } =
    params;

  const bundle = await trace.measure('agent:researcher', 'agent', () =>
    collectResources({ keywords, settings, manualResources, scoreContext, rag, signal }),
  );

  // 内容级检索：抓正文 → 分块 → 召回证据（未开启或失败都会返回 enabled=false，不会抛）
  const runtime = rag?.runtime;
  const evidence =
    evidenceFetch && runtime
      ? await trace.measure('agent:researcher.evidence', 'tool', () =>
          buildEvidence({ items: bundle.items, query, runtime, fetch: evidenceFetch, signal }),
        )
      : emptyEvidence();

  const checked = validatePayload(evidencePayloadSchema, {
    chunkIds: evidence.chunks.map((c) => c.id),
    count: evidence.chunks.length,
    degraded: !evidence.enabled,
  });
  if (!checked.ok) throw new Error(`Researcher 输出不符合契约：${checked.error}`);

  const messages: Array<AgentMessage<unknown>> = [
    makeMessage({
      from: 'researcher',
      to: 'planner',
      type: 'evidence.pack',
      payload: {
        items: bundle.items.length,
        chunkIds: evidence.chunks.map((c) => c.id),
        degraded: !evidence.enabled,
      },
      traceId: trace.id,
    }),
  ];
  return { messages, bundle, evidence };
}

function emptyEvidence(): EvidencePack {
  return {
    enabled: false,
    chunks: [],
    fetched: 0,
    skipped: 0,
    embedded: 0,
    reused: 0,
    degradedReason: '未配置正文抓取',
    promptSection: '',
  };
}

// ---------------- 角色 3：Planner ----------------

export interface PlannerParams {
  input: PlanGenInput;
  answers: ClarificationAnswer[];
  profile?: HabitProfile | null;
  bundle: ResourceBundle;
  config: LLMConfig;
  memoryHits?: MemoryHit[];
  evidence?: EvidencePack;
  trace: TraceRecorder;
  signal?: AbortSignal;
  now?: Date;
}

export interface PlannerOutput {
  message: AgentMessage<unknown>;
  result: ComposePlanResult;
}

export async function runPlanner(params: PlannerParams): Promise<PlannerOutput> {
  const { input, answers, profile, bundle, config, memoryHits, evidence, trace, signal, now } = params;

  const result = await trace.measure('agent:planner', 'agent', () =>
    composePlan({ input, answers, profile, resources: bundle, config, memoryHits, evidence, signal, now }),
  );

  const checked = validatePayload(planPayloadSchema, {
    planId: result.plan.id,
    days: result.plan.days.length,
    source: result.source,
  });
  if (!checked.ok) throw new Error(`Planner 输出不符合契约：${checked.error}`);

  return {
    result,
    message: makeMessage({
      from: 'planner',
      to: 'critic',
      type: 'plan.draft',
      payload: { planId: result.plan.id, days: result.plan.days.length, source: result.source },
      traceId: trace.id,
    }),
  };
}

// ---------------- 角色 4：Critic（包装确定性校验） ----------------

export function makeCritiqueMessage(
  report: { ok: boolean; checked: number; violations: unknown[] },
  traceId: string,
): AgentMessage<unknown> {
  const payload = { ok: report.ok, checked: report.checked, violations: report.violations };
  const checked = validatePayload(critiquePayloadSchema, payload);
  if (!checked.ok) throw new Error(`Critic 输出不符合契约：${checked.error}`);
  return makeMessage({
    from: 'critic',
    to: 'orchestrator',
    type: 'critique.report',
    payload: checked.value,
    traceId,
  });
}
