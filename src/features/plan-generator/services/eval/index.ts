// src/features/plan-generator/services/eval/index.ts
// 离线评测模块的统一出口。
//
// 层次：
//   metrics  —— 指标口径（纯函数，含"分母为 0"的显式约定）
//   replay   —— 回放桩：按 system prompt 路由脚本响应，含确定性伪向量
//   cases    —— 固定用例集（每条都写清"守住什么"）
//   runner   —— 跑真实链路 + 逐条核对期望 + 汇总门禁
//   report   —— 文本 / Markdown 报告
export * from './types';
export * from './metrics';
export * from './replay';
export * from './cases';
export * from './runner';
export * from './report';
