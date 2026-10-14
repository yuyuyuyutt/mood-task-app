// src/features/plan-generator/services/agent/tools/gate.ts
// 权限门 + 确认闸门：模型与"真实副作用"之间的唯一通道。
//
// 三道关（任何一道不过就直接拒绝，绝不"尽力而为"）：
//   1) 白名单：工具名必须在注册表里；
//   2) scope：工具声明的权限必须全部包含在当前会话的授权里；
//   3) 参数校验：zod 校验通过才允许执行。
// 再加一道人工关：写工具只允许"干跑 + 出预览"，用户确认后才调用 commit（一次性令牌，5 分钟过期）。
import type { PlanEditDiff, RegisteredSkill, SkillContext, SkillScope } from './types';
import { skillRegistry, type SkillRegistry } from './registry';

export interface SkillDispatchOk {
  status: 'ok';
  skill: string;
  output: unknown;
}

export interface SkillDispatchPending {
  status: 'needs_confirmation';
  skill: string;
  /** 一次性确认令牌 */
  token: string;
  summary: string;
  diff: PlanEditDiff;
}

export interface SkillDispatchRejected {
  status: 'rejected';
  skill: string;
  reason: string;
}

export type SkillDispatchResult = SkillDispatchOk | SkillDispatchPending | SkillDispatchRejected;

export type SkillCommitResult =
  | { status: 'ok'; skill: string; diff?: PlanEditDiff }
  | { status: 'rejected'; skill: string; reason: string };

interface PendingCall {
  skill: RegisteredSkill;
  args: unknown;
  result: unknown;
  diff: PlanEditDiff;
  createdAt: number;
}

/** 确认令牌有效期：超时即失效，避免"几小时前点过确认"的东西被悄悄提交 */
export const CONFIRM_TTL_MS = 5 * 60 * 1000;

export class SkillGate {
  private readonly pending = new Map<string, PendingCall>();
  private seq = 0;

  constructor(
    private readonly ctx: SkillContext,
    private readonly registry: SkillRegistry = skillRegistry,
  ) {}

  get scopes(): SkillScope[] {
    return this.ctx.scopes;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  /** 当前会话可见（有权限）的工具 —— prompt 里只列这些 */
  listVisible(): RegisteredSkill[] {
    return this.registry.visible(this.ctx.scopes);
  }

  /**
   * 干跑一次工具调用。
   * 读工具：直接返回结果；写工具：返回 diff 预览 + 一次性令牌（未提交，无副作用）。
   */
  async dispatch(name: string, rawArgs: unknown): Promise<SkillDispatchResult> {
    const skill = this.registry.get(name);
    if (!skill) {
      return { status: 'rejected', skill: name, reason: `未注册的工具（白名单外）：${name || '(空)'}` };
    }

    const missing = skill.scopes.filter((scope) => !this.ctx.scopes.includes(scope));
    if (missing.length > 0) {
      return { status: 'rejected', skill: name, reason: `缺少权限范围：${missing.join('、')}` };
    }

    const parsed = skill.validate(rawArgs ?? {});
    if (!parsed.ok) {
      return { status: 'rejected', skill: name, reason: `参数校验未通过（${parsed.reason}）` };
    }

    let result: unknown;
    try {
      result = await skill.run(parsed.args, this.ctx);
    } catch (err) {
      return {
        status: 'rejected',
        skill: name,
        reason: `执行失败：${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (skill.sideEffect === 'read') {
      return { status: 'ok', skill: name, output: result };
    }

    const diff = skill.preview(parsed.args, result);
    if (!diff) {
      // 安全默认值：写工具没给预览就不执行，避免"看不见的修改"
      return { status: 'rejected', skill: name, reason: '写工具未提供变更预览，已按安全默认值拒绝执行' };
    }

    this.seq += 1;
    const token = `tok-${Date.now().toString(36)}-${this.seq}`;
    this.pending.set(token, { skill, args: parsed.args, result, diff, createdAt: Date.now() });
    return { status: 'needs_confirmation', skill: name, token, summary: diff.summary, diff };
  }

  /** 用户确认后提交（令牌一次性：确认即消费） */
  async commit(token: string): Promise<SkillCommitResult> {
    const call = this.pending.get(token);
    if (!call) return { status: 'rejected', skill: '', reason: '确认令牌无效或已被使用' };
    this.pending.delete(token);

    if (Date.now() - call.createdAt > CONFIRM_TTL_MS) {
      return { status: 'rejected', skill: call.skill.name, reason: '确认已过期（超过 5 分钟），请重新发起调整' };
    }

    try {
      await call.skill.commit(call.args, call.result, this.ctx);
    } catch (err) {
      return {
        status: 'rejected',
        skill: call.skill.name,
        reason: `提交失败：${err instanceof Error ? err.message : String(err)}`,
      };
    }
    return { status: 'ok', skill: call.skill.name, diff: call.diff };
  }

  /** 用户取消 / 组件卸载时丢弃待确认的调用 */
  discard(token: string): void {
    this.pending.delete(token);
  }
}
