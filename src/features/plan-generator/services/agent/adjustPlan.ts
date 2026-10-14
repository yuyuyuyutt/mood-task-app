// src/features/plan-generator/services/agent/adjustPlan.ts
// 对话式计划调整：一次"单步 Agent run"。
//
// 流程（每一步都在 trace 里留痕）：
//   1) 宿主执行**只读工具**拿到上下文（计划摘要 / 资源清单 / 历史记忆）——模型不自己去读数据；
//   2) 模型只做一个决策：选哪个工具、参数是什么（结构化 JSON，白名单校验）；
//   3) 工具过闸门：未注册 / 缺权限 / 参数不合法 → 直接拒绝并给出原因；
//   4) 写工具只产出 diff 预览 + 一次性令牌，**用户点确认才 commit**；
//   5) 模型不可用时退化为"确定性指令解析"（顺延/压缩/删除三类），保证功能不依赖模型。
import type { GeneratedPlan, MemoryHit } from '../../types';
import { asString, extractJsonObject } from '../jsonExtract';
import type { LLMConfig } from '../llmClient';
import { callChat } from '../llm/chatClient';
import { TOOL_CALL_SCHEMA } from '../llm/schemas';
import { ADJUST_RULE_HINT, buildAdjustMessages } from '../prompts';
import { llmTasks } from '../llmTaskManager';
import { TraceRecorder } from './trace';
import { SkillGate, type SkillDispatchResult } from './tools/gate';
import { builtinRegistry } from './tools/builtin';
import type { PlanEditDiff, SkillContext, SkillScope } from './tools/types';

/** 向导会话授予的全部权限；真实系统里应由用户/角色决定，这里先固定为"当前用户的全权" */
export const ADJUST_SESSION_SCOPES: SkillScope[] = [
  'plan:read',
  'plan:write',
  'task:write',
  'memory:read',
  'memory:write',
  'resource:read',
];

export interface ToolCallIntent {
  tool: string;
  args: unknown;
  reply: string;
}

/** 解析模型的工具调用输出（结构化 JSON，字段缺失即抛错走降级） */
export function parseToolCallJson(text: string): ToolCallIntent {
  const obj = extractJsonObject<Record<string, unknown>>(text);
  const tool = asString(obj.tool, 40);
  if (!tool) throw new Error('模型输出缺少工具名');
  const args = obj.args && typeof obj.args === 'object' ? obj.args : {};
  const reply = asString(obj.reply, 200) || '已生成变更建议，请确认。';
  return { tool, args, reply };
}

/**
 * 确定性指令解析（模型不可用时的兜底）。
 * 只覆盖三类高频、无歧义的诉求，其余一律返回 null 并提示可用指令 —— 不做"猜用户意图"。
 */
export function parseRuleInstruction(instruction: string): ToolCallIntent | null {
  const text = instruction.trim();
  if (!text) return null;

  const remove = text.match(/第\s*(\d+)\s*天[^\d]{0,8}第\s*(\d+)\s*项/);
  if (remove && /(删|去掉|移除|不要)/.test(text)) {
    return {
      tool: 'remove_task',
      args: { day: Number(remove[1]), item: Number(remove[2]) },
      reply: `删除第 ${remove[1]} 天的第 ${remove[2]} 项`,
    };
  }

  const shift = text.match(/(?:顺延|推迟|延后|往后推|推后)\s*(\d+)\s*天/);
  if (shift) {
    return {
      tool: 'shift_plan_days',
      args: { days: Number(shift[1]) },
      reply: `把计划整体顺延 ${shift[1]} 天`,
    };
  }

  const compress = text.match(/(?:压缩到|压缩至|压到|每天|日均)[^\d]{0,4}(\d+)\s*分钟/);
  if (compress) {
    return {
      tool: 'compress_daily_minutes',
      args: { minutes: Number(compress[1]) },
      reply: `把每天的任务总时长压缩到约 ${compress[1]} 分钟`,
    };
  }

  return null;
}

export interface PlanAdjustParams {
  instruction: string;
  plan: GeneratedPlan;
  config: LLMConfig;
  signal?: AbortSignal;
  now?: Date;
}

export interface PlanAdjustOk {
  status: 'ok';
  reply: string;
  diff: PlanEditDiff;
  /** 一次性确认令牌（用户点确认时用） */
  token: string;
  gate: SkillGate;
  traceId: string;
  source: 'llm' | 'rule';
}

export interface PlanAdjustRejected {
  status: 'rejected';
  reply: string;
  reason: string;
  traceId: string;
  source: 'llm' | 'rule';
}

export interface PlanAdjustFailed {
  status: 'failed';
  reply: string;
  reason: string;
  traceId: string;
}

export type PlanAdjustResult = PlanAdjustOk | PlanAdjustRejected | PlanAdjustFailed;

type ReadOutput = { text?: string } & Record<string, unknown>;

/**
 * 只读工具理论上不会返回 needs_confirmation，但类型上仍需收口：
 * 统一在这里取"拒绝原因"，避免调用方到处做三态判断。
 */
function rejectionReason(result: SkillDispatchResult): string {
  if (result.status === 'rejected') return result.reason;
  if (result.status === 'needs_confirmation') return '只读工具不应产生待确认变更';
  return '';
}

/**
 * 执行一次对话式调整（干跑）。
 * 返回 ok 时**还没有任何副作用**，需要用户确认后调用 commitAdjust。
 */
export async function adjustPlan(params: PlanAdjustParams): Promise<PlanAdjustResult> {
  const { instruction, plan, config, signal, now } = params;
  const trace = new TraceRecorder('adjust', instruction).setLevel('agent').setModel(config.model ?? null);

  const ctx: SkillContext = { scopes: ADJUST_SESSION_SCOPES, plan, now };
  const gate = new SkillGate(ctx, builtinRegistry);
  const visible = gate.listVisible();
  trace.step(
    'tools:visible',
    'guard',
    0,
    true,
    `${visible.length} 个可用工具（含 ${visible.filter((s) => s.sideEffect === 'write').length} 个写工具，需用户确认）`,
  );

  // ---- 1) 宿主执行只读工具，准备上下文 ----
  let planSummary = '';
  let resourceText = '';
  let memorySection = '';

  const summaryCall = await gate.dispatch('get_plan_summary', {});
  if (summaryCall.status === 'ok') {
    planSummary = (summaryCall.output as ReadOutput).text ?? '';
    trace.tool('get_plan_summary', true);
  } else {
    trace.tool('get_plan_summary', false, rejectionReason(summaryCall));
  }

  const resourceCall = await gate.dispatch('get_plan_resources', { limit: 10 });
  if (resourceCall.status === 'ok') {
    resourceText = (resourceCall.output as ReadOutput).text ?? '';
    trace.tool('get_plan_resources', true);
  }

  const memoryCall = await gate.dispatch('recall_memory', { limit: 2 });
  if (memoryCall.status === 'ok') {
    const hits = (memoryCall.output as { hits?: MemoryHit[] }).hits ?? [];
    memorySection = (memoryCall.output as ReadOutput).text ?? '';
    trace.tool('recall_memory', true).memory(hits.map((h) => h.note.id));
  } else {
    trace.tool('recall_memory', false, rejectionReason(memoryCall));
  }

  // ---- 2) 决策：模型优先，规则兜底 ----
  let intent: ToolCallIntent | null = null;
  let source: 'llm' | 'rule' = 'rule';

  if (config.enabled && config.model) {
    try {
      const res = await trace.measure('chat:adjust', 'llm', () =>
        llmTasks.run({
          kind: 'adjust',
          key: 'adjust',
          timeoutMs: config.timeoutMs ?? 90_000,
          signal,
          run: (taskSignal) =>
            callChat(
              buildAdjustMessages({
                instruction,
                planSummary: resourceText ? `${planSummary}\n\n可用资源：\n${resourceText}` : planSummary,
                skillLines: builtinRegistry.describeForPrompt(visible),
                memorySection,
              }),
              config,
              { signal: taskSignal, schema: TOOL_CALL_SCHEMA },
            ),
        }),
      );
      trace.setSchemaApplied(res.schemaApplied);
      for (const w of res.warnings) trace.warn(w);
      intent = parseToolCallJson(res.text);
      source = 'llm';
    } catch (err) {
      trace.fallback('adjust', err instanceof Error ? err.message : String(err));
    }
  } else {
    trace.fallback('adjust', config.enabled ? '未选择模型' : 'AI 未开启');
  }

  if (!intent) {
    intent = parseRuleInstruction(instruction);
    if (!intent) {
      const finished = trace.end();
      return {
        status: 'failed',
        reply: `没能理解这条调整指令。${ADJUST_RULE_HINT}`,
        reason: '无法把指令解析为任何已注册工具',
        traceId: finished.id,
      };
    }
  }

  if (intent.tool === 'none') {
    const finished = trace.end();
    return {
      status: 'rejected',
      reply: intent.reply || '这条诉求无法用现有工具表达。',
      reason: '无可用工具',
      traceId: finished.id,
      source,
    };
  }

  // ---- 3) 过闸门（白名单 + scope + 参数校验 + 写操作待确认）----
  const dispatched = await gate.dispatch(intent.tool, intent.args);

  if (dispatched.status === 'rejected') {
    trace.tool(intent.tool, false, dispatched.reason, intent.args);
    const finished = trace.end();
    return { status: 'rejected', reply: dispatched.reason, reason: dispatched.reason, traceId: finished.id, source };
  }

  if (dispatched.status === 'ok') {
    trace.tool(intent.tool, false, '只读工具不能用于修改计划', intent.args);
    const finished = trace.end();
    return {
      status: 'rejected',
      reply: `${intent.tool} 是只读工具，不会修改计划。`,
      reason: '模型选择了只读工具',
      traceId: finished.id,
      source,
    };
  }

  trace.tool(intent.tool, true, `待用户确认：${dispatched.summary}`, intent.args);
  const finished = trace.end();
  return {
    status: 'ok',
    reply: intent.reply,
    diff: dispatched.diff,
    token: dispatched.token,
    gate,
    traceId: finished.id,
    source,
  };
}

/** 用户确认后提交：返回应用了 diff 的新计划（不改动传入的 plan） */
export async function commitAdjust(
  gate: SkillGate,
  token: string,
  plan: GeneratedPlan,
): Promise<{ ok: boolean; plan?: GeneratedPlan; reason?: string }> {
  const res = await gate.commit(token);
  if (res.status !== 'ok') return { ok: false, reason: res.reason };
  if (!res.diff) return { ok: false, reason: '确认通过但缺少变更内容' };
  return { ok: true, plan: res.diff.apply(plan) };
}

/** 用户取消时丢弃待确认的调用（令牌不可再用） */
export function discardAdjust(gate: SkillGate, token: string): void {
  gate.discard(token);
}
