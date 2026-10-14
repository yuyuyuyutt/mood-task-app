// src/features/plan-generator/services/agent/tools/types.ts
// Skill（工具）体系的类型契约。
//
// 设计原则（对应文档里的"模型只做决策，动作必须过闸门"）：
//   1) **白名单注册**：只有显式 register 过的工具才可被调用，模型输出里出现未注册的名字一律拒绝；
//   2) **参数即不可信输入**：模型给的 args 必须过 zod 校验，校验不过直接拒绝，不做"尽力修补"；
//   3) **读写分级 + scope 权限**：读工具直接执行；写工具必须先返回 diff 预览，用户确认后才 commit；
//   4) **干跑/提交分离**：execute 永远是"纯计算或只读"，副作用只允许发生在 commit（若存在）。
import type { z } from 'zod';
import type { GeneratedPlan } from '../../../types';

/** 权限范围：与插件系统的 namespace 权限门同构 —— 校验发生在能力内部，不靠调用方自觉 */
export type SkillScope =
  | 'plan:read'
  | 'plan:write'
  | 'task:write'
  | 'memory:read'
  | 'memory:write'
  | 'resource:read';

export type SideEffect = 'read' | 'write';

export interface SkillContext {
  /** 本次会话被授予的权限范围 */
  scopes: SkillScope[];
  /** 当前计划草稿（计划类工具的工作对象） */
  plan: GeneratedPlan | null;
  now?: Date;
}

export type PlanEditKind =
  | 'move_task'
  | 'resize_task'
  | 'rename_task'
  | 'remove_task'
  | 'compress_day'
  | 'shift_day';

/** 一条可读的变更记录（UI 直接渲染，不需要再解析） */
export interface PlanEditChange {
  kind: PlanEditKind;
  /** 变更后所属日期 YYYY-MM-DD */
  day: string;
  /** 变更前所属日期（移动类变更才有） */
  from?: string;
  title: string;
  detail: string;
}

/**
 * 变更预览（dry-run 结果）。
 * `apply` 是**纯函数**：把 diff 施加到计划上得到新计划。
 * 这样一来"LLM 只负责决策、确定性代码负责算 diff"，diff 可预览、可测试、可回放。
 */
export interface PlanEditDiff {
  skill: string;
  summary: string;
  changes: PlanEditChange[];
  apply: (plan: GeneratedPlan) => GeneratedPlan;
}

export interface SkillDefinition<A, R> {
  name: string;
  /** 中文短标题（UI 展示） */
  title: string;
  /** 给模型看的能力说明（会进入 prompt） */
  description: string;
  scopes: SkillScope[];
  sideEffect: SideEffect;
  /** 参数说明（进入 prompt，用中文写清楚取值范围，小模型更吃得准） */
  paramsHint: string;
  /** 参数校验：模型给的 args 一律当不可信输入 */
  schema: z.ZodType<A>;
  /** 干跑：只读或纯计算，绝不产生副作用 */
  execute(args: A, ctx: SkillContext): Promise<R>;
  /** 需要用户确认后才执行的副作用（草稿类变更由宿主应用 diff，不需要它） */
  commit?(args: A, result: R, ctx: SkillContext): Promise<void>;
  /** 写工具必须提供预览，否则闸门会拒绝执行（安全默认值） */
  preview?(args: A, result: R): PlanEditDiff | undefined;
}

/** 注册表里的统一形态：异构 skill 适配后的样子 */
export interface RegisteredSkill {
  name: string;
  title: string;
  description: string;
  scopes: SkillScope[];
  sideEffect: SideEffect;
  paramsHint: string;
  validate(raw: unknown): { ok: true; args: unknown } | { ok: false; reason: string };
  run(args: unknown, ctx: SkillContext): Promise<unknown>;
  commit(args: unknown, result: unknown, ctx: SkillContext): Promise<void>;
  preview(args: unknown, result: unknown): PlanEditDiff | undefined;
}
