// src/features/plan-generator/services/agent/tools/registry.ts
// 工具注册表：**白名单的单一真源**。
//
// 它对上层只暴露三件事：
//   - validate：参数校验（zod）；
//   - run：干跑执行；
//   - commit / preview：写操作的提交与预览。
// prompt 里的"可用工具"清单也由它生成 —— 模型看到的工具集与宿主真正允许执行的工具集
// **来自同一个地方**，因此不存在"prompt 里写了但宿主不认"的漂移。
import type { z } from 'zod';
import type {
  PlanEditDiff,
  RegisteredSkill,
  SkillContext,
  SkillDefinition,
  SkillScope,
} from './types';

/** 把 zod 校验错误压成一行可读原因（写进 trace / 返回给模型） */
export function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('；');
}

/**
 * 把异构 SkillDefinition 适配成统一形态。
 * 这是整个工具层**唯一**一处类型断言（args as A）：把校验与执行绑在一起，
 * 保证运行时进入 execute 的参数一定已经过 schema.safeParse。
 */
export function defineSkill<A, R>(def: SkillDefinition<A, R>): RegisteredSkill {
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    scopes: def.scopes,
    sideEffect: def.sideEffect,
    paramsHint: def.paramsHint,
    validate: (raw) => {
      const parsed = def.schema.safeParse(raw);
      if (!parsed.success) return { ok: false, reason: formatZodIssues(parsed.error) };
      return { ok: true, args: parsed.data };
    },
    run: (args, ctx: SkillContext) => def.execute(args as A, ctx),
    commit: async (args, result, ctx) => {
      if (def.commit) await def.commit(args as A, result as R, ctx);
    },
    preview: (args, result) => (def.preview ? def.preview(args as A, result as R) : undefined),
  };
}

export class SkillRegistry {
  private readonly skills = new Map<string, RegisteredSkill>();

  register(...skills: RegisteredSkill[]): this {
    for (const skill of skills) {
      if (this.skills.has(skill.name)) {
        throw new Error(`工具重复注册：${skill.name}`);
      }
      this.skills.set(skill.name, skill);
    }
    return this;
  }

  get(name: string): RegisteredSkill | undefined {
    return this.skills.get(name);
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }

  list(): RegisteredSkill[] {
    return [...this.skills.values()];
  }

  /** 按权限过滤：模型只应看到当前会话有权使用的工具（能力可见性收敛） */
  visible(scopes: SkillScope[]): RegisteredSkill[] {
    return this.list().filter((s) => s.scopes.every((scope) => scopes.includes(scope)));
  }

  /** 生成 prompt 里的工具清单（含参数说明）；写工具显式标注"需用户确认" */
  describeForPrompt(skills: RegisteredSkill[] = this.list()): string[] {
    return skills.map(
      (s) =>
        `- ${s.name}（${s.sideEffect === 'write' ? '写操作，需用户确认' : '只读'}）：${s.description} 参数：${
          s.paramsHint
        }`,
    );
  }
}

/** 全局注册表：内置工具在 builtin/index.ts 里注册 */
export const skillRegistry = new SkillRegistry();

export type { PlanEditDiff, RegisteredSkill, SkillDefinition, SkillScope };
