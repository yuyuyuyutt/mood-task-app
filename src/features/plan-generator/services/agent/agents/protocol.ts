// src/features/plan-generator/services/agent/agents/protocol.ts
// 多角色协作的**消息契约**。
//
// 核心约束：角色之间不走自由文本。
//   每一跳的 payload 都必须先过 zod schema 才允许被下一个角色消费 ——
//   某个角色输出跑偏时，问题在**边界处**就被挡住，不会污染下游上下文
//   （"多个 agent 自由对话，出了事不知道是谁污染的"是这类系统最常见的失败模式）。
//
// 消息里带上 `traceId` 与 `at`，是为了让整条链在轨迹里可回放：
// 谁在第几步、用什么输入、产出了什么、是否被 schema 拒绝。
import { z } from 'zod';

export type AgentRole = 'orchestrator' | 'clarifier' | 'researcher' | 'planner' | 'critic' | 'user';

/**
 * 本次运行实际走到了哪一级能力（写进 trace，UI 也会显示）：
 * - `multi`    ：四个角色全部跑通（澄清 → 检索 → 规划 → 校验）
 * - `single`   ：部分 specialist 失败，规划仍然由模型完成
 * - `pipeline` ：只有检索 + 规划（澄清/校验未参与）
 * - `rule`     ：规划回退到确定性规则引擎
 */
export type AgentLevel = 'multi' | 'single' | 'pipeline' | 'rule';

export interface AgentMessage<T> {
  id: string;
  from: AgentRole;
  to: AgentRole;
  /** 消息类型（如 'clarify.questions'、'critique.report'），用于日志与 UI 分组 */
  type: string;
  payload: T;
  traceId: string;
  at: string;
}

let messageSeq = 0;

export function makeMessage<T>(params: {
  from: AgentRole;
  to: AgentRole;
  type: string;
  payload: T;
  traceId: string;
  at?: Date;
}): AgentMessage<T> {
  messageSeq += 1;
  return {
    id: `msg-${messageSeq}`,
    from: params.from,
    to: params.to,
    type: params.type,
    payload: params.payload,
    traceId: params.traceId,
    at: (params.at ?? new Date()).toISOString(),
  };
}

/** 结构上等同于一条澄清问答（这里单独定义，避免协议层依赖业务类型） */
export const qaSchema = z.object({
  id: z.string().min(1).max(40),
  question: z.string().min(2).max(200),
  answer: z.string().min(1).max(400),
});

export const clarifyPayloadSchema = z.object({
  questions: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        question: z.string().min(2).max(300),
      }),
    )
    .max(8),
  /** llm = 模型生成；template = 模板兜底 */
  source: z.enum(['llm', 'template']),
});

export const answerPayloadSchema = z.object({
  id: z.string().min(1).max(40),
  question: z.string().min(2).max(200),
  answer: z.string().min(1).max(400),
  /**
   * 结论依据（**必须显式标注**，假设不能冒充事实）：
   * - `profile`：来自本地习惯画像（完成率 / 高效时段 / 平均耗时）
   * - `memory` ：来自历史计划的成败记忆
   * - `default`：没有依据，按保守假设填写 —— 这类会在 UI 里单独提示用户核对
   *
   * 刻意**没有** `evidence` 这一档：澄清问题问的是"用户的情况"，
   * 而正文证据讲的是"世界上的知识"，用后者回答前者只会编出看似合理的假事实。
   */
  basis: z.enum(['profile', 'memory', 'default']),
});

export const evidencePayloadSchema = z.object({
  chunkIds: z.array(z.string().min(1)).max(64),
  count: z.number().int().min(0).max(64),
  degraded: z.boolean(),
});

export const planPayloadSchema = z.object({
  planId: z.string().min(1),
  days: z.number().int().min(1),
  source: z.enum(['llm', 'rule']),
});

export const violationSchema = z.object({
  type: z.enum([
    'items_per_day',
    'duration_sum',
    'unknown_citation',
    'missing_risk',
    'empty_day',
    'uncovered_evidence',
  ]),
  day: z.string().max(20).optional(),
  detail: z.string().min(2).max(200),
  severity: z.enum(['error', 'warn']),
});

export const critiquePayloadSchema = z.object({
  ok: z.boolean(),
  checked: z.number().int().min(0),
  violations: z.array(violationSchema).max(64),
});

export type ValidateResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * 边界校验：payload 不合契约就**拒绝**这一跳（由调用方决定降级或终止）。
 * 不做"尽力修补"——修补会让错误静默传播，正是要避免的。
 */
export function validatePayload<T>(schema: z.ZodType<T>, payload: unknown): ValidateResult<T> {
  const parsed = schema.safeParse(payload);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issue = parsed.error.issues[0];
  const path = issue?.path.length ? issue.path.join('.') : '(root)';
  return { ok: false, error: `${path}: ${issue?.message ?? '不符合契约'}` };
}
