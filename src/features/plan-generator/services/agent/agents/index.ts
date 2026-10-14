// src/features/plan-generator/services/agent/agents/index.ts
// 多角色协作层的统一出口。
//
// 分层（自下而上）：
//   protocol  —— 结构化消息契约（zod）与能力级别定义
//   critic    —— 确定性约束校验 + 安全修正 + 计划差异
//   roles     —— Clarifier / Researcher / Planner 的薄封装 + 澄清自答
//   orchestrator —— 确定性编排：谁先谁后、失败退到哪一级
export * from './protocol';
export * from './critic';
export * from './roles';
export * from './orchestrator';
