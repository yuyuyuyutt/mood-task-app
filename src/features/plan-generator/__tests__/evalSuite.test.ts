// src/features/plan-generator/__tests__/evalSuite.test.ts
// 离线评测的**执行入口**：`npm run eval` 跑的就是这个文件。
//
// 与其他测试的区别：它不测"某个函数对不对"，而是跑一遍完整链路并核对**产品级承诺**
// （不降级、不编造引用、模型挂了也能出计划、工具提交真的生效），
// 最后按门禁给出"这版比上版好还是差"的结论。
import { describe, expect, it } from 'vitest';
import { formatReport, runEvalSuite } from '../services/eval';

describe('离线评测（脚本回放，不联网 / 不需要模型）', () => {
  it('整套用例通过全部门禁', async () => {
    const report = await runEvalSuite();

    // 报告直接打到控制台：CI 日志里能一眼看到指标与失败用例
    console.log(formatReport(report));

    // 逐条列出失败原因（比只报一个总断言更好定位）
    expect(report.failures).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.cases.length).toBeGreaterThanOrEqual(6);
  }, 30_000);
});
