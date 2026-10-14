// src/features/plan-generator/services/agent/tools/builtin/index.ts
// 内置工具注册入口。
//
// 注册是**幂等**的：模块被重复导入（测试、HMR）不会抛"重复注册"。
// 所有内置工具集中在这里注册，意味着"系统能用哪些能力"在这一个文件里就能读完。
import { skillRegistry, type SkillRegistry } from '../registry';
import { planQuerySkills } from './planQueryTools';
import { planEditSkills } from './planEditTools';

export const ALL_SKILLS = [...planQuerySkills, ...planEditSkills];

let registered = false;

export function registerBuiltinSkills(registry: SkillRegistry = skillRegistry): SkillRegistry {
  if (registered) return registry;
  registry.register(...ALL_SKILLS);
  registered = true;
  return registry;
}

/** 导入本模块即可拿到已注册好内置工具的注册表 */
export const builtinRegistry = registerBuiltinSkills();

export * from './planQueryTools';
export * from './planEditTools';
