// src/features/plan-generator/services/eval/metrics.ts
// 指标计算（**纯函数**）。
//
// 单独抽出来的原因：指标口径比看起来更容易写错，而且一旦写错，评测就会给出"稳定的错答案"。
// 所以这里每个函数都可单测，并且对"分母为 0"这种边界给出**显式约定**（见下）。

/**
 * 安全比值：分母为 0 时返回 fallback。
 * 约定：**"没有可判定的样本"视为通过**（fallback=1）。理由是评测的语义是"没发现问题"，
 * 而不是"用 0 分惩罚没数据"；同时报告里会单独给出样本数，避免读者误以为覆盖很全。
 */
export function safeRatio(numerator: number, denominator: number, fallback = 1): number {
  if (!Number.isFinite(denominator) || denominator <= 0) return fallback;
  return numerator / denominator;
}

/** 引用精度：白名单放行的引用 / 模型给出的全部引用；一条引用都没有时视为 1 */
export function precision(kept: number, dropped: number): number {
  return safeRatio(kept, kept + dropped, 1);
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** 最近秩百分位（nearest-rank）：样本少时比线性插值更稳，也不会给出不存在的分位值 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}

/** 布尔序列的比例（空序列按通过处理，理由同 safeRatio） */
export function rate(flags: boolean[]): number {
  return safeRatio(flags.filter(Boolean).length, flags.length, 1);
}

/** 统一保留 3 位小数，避免报告里出现 0.6666666666666666 */
export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** 百分比字符串（报告展示用） */
export function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
