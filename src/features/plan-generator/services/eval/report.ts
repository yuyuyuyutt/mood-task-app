// src/features/plan-generator/services/eval/report.ts
// 评测报告的渲染（纯函数）：控制台文本 + Markdown 两种形态。
//
// 为什么报告要单独写：指标只有被**看见**才有意义。控制台版本给 `npm run eval`，
// Markdown 版本可以贴进 PR / 文档当"改前改后"的对比证据。
import { percent } from './metrics';
import type { EvalCaseResult, EvalReport } from './types';

function passTag(passed: boolean): string {
  return passed ? '✅' : '❌';
}

function caseLine(r: EvalCaseResult): string {
  const parts: string[] = [];
  if (r.observation) {
    const o = r.observation;
    parts.push(`${o.mode}/${o.source}${o.level ? `→${o.level}` : ''}`);
    parts.push(`引用精度 ${percent(o.citationPrecision)}`);
    // 降级要连"降在哪一步"一起报：否则只看到一个数字，没法定位
    parts.push(`降级 ${o.fallbacks}${o.fallbackStages.length > 0 ? `（${o.fallbackStages.join('、')}）` : ''}`);
    parts.push(`步数 ${o.steps}`);
    parts.push(`${o.ms}ms`);
  }
  if (r.error) parts.push(`异常：${r.error}`);
  return parts.join(' · ');
}

function metricRows(report: EvalReport): Array<[string, string]> {
  const { metrics: m, thresholds: t } = report;
  return [
    ['用例通过率', `${percent(m.passRate)}（门禁 ≥ ${percent(t.passRate)}）`],
    ['schema 一次通过率', `${percent(m.schemaPassRate)}（门禁 ≥ ${percent(t.schemaPassRate)}）`],
    ['降级用例比例', `${percent(m.degradationRate)}（门禁 ≤ ${percent(t.maxDegradationRate)}）`],
    [
      '引用精度',
      `${percent(m.citationPrecision)}（门禁 ≥ ${percent(t.citationPrecision)}；不含 ${m.adversarialCaseCount} 条对抗用例）`,
    ],
    ['约束达成率', `${percent(m.constraintRate)}（门禁 ≥ ${percent(t.constraintRate)}）`],
    ['证据覆盖', percent(m.evidenceCoverage)],
    ['工具成功率', `${percent(m.toolSuccessRate)}（门禁 ≥ ${percent(t.toolSuccessRate)}）`],
    ['平均轨迹步数', String(m.meanSteps)],
    ['P95 耗时', `${m.p95LatencyMs}ms`],
  ];
}

/** 控制台报告（`npm run eval` 直接打印） */
export function formatReport(report: EvalReport): string {
  const lines: string[] = [];
  lines.push('══════════════════════════════════════════════════════════════');
  lines.push(`离线评测报告  ${report.generatedAt}`);
  lines.push(`结论：${report.ok ? '✅ 全部门禁通过' : '❌ 存在未达标项'}`);
  lines.push('──────────────────────────────────────────────────────────────');
  for (const [label, value] of metricRows(report)) {
    lines.push(`  ${label.padEnd(20, ' ')} ${value}`);
  }
  lines.push('──────────────────────────────────────────────────────────────');
  for (const r of report.cases) {
    lines.push(`  ${passTag(r.passed)} ${r.caseId}  ${r.title}`);
    lines.push(`     ${caseLine(r)}`);
    lines.push(`     守住的是：${r.rationale}`);
    for (const f of r.failures) lines.push(`     ✕ ${f}`);
  }
  if (report.failures.length > 0) {
    lines.push('──────────────────────────────────────────────────────────────');
    lines.push('未达标项：');
    for (const f of report.failures) lines.push(`  ✕ ${f}`);
  }
  lines.push('──────────────────────────────────────────────────────────────');
  for (const note of report.notes) lines.push(`  · ${note}`);
  lines.push('══════════════════════════════════════════════════════════════');
  return lines.join('\n');
}

/** Markdown 报告（可贴进 PR / 文档） */
export function formatMarkdown(report: EvalReport): string {
  const lines: string[] = [];
  lines.push(`## 离线评测报告`);
  lines.push('');
  lines.push(`- 生成时间：${report.generatedAt}`);
  lines.push(`- 结论：${report.ok ? '✅ 全部门禁通过' : '❌ 存在未达标项'}`);
  lines.push('');
  lines.push('| 指标 | 数值 |');
  lines.push('|---|---|');
  for (const [label, value] of metricRows(report)) {
    lines.push(`| ${label} | ${value} |`);
  }
  lines.push('');
  lines.push('| 用例 | 模式 | 结果 | 引用精度 | 降级 | 步数 | 耗时 |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of report.cases) {
    const o = r.observation;
    lines.push(
      `| ${r.caseId} | ${r.mode} | ${passTag(r.passed)} | ${
        o ? percent(o.citationPrecision) : '—'
      } | ${o?.fallbacks ?? '—'} | ${o?.steps ?? '—'} | ${o ? `${o.ms}ms` : '—'} |`,
    );
  }
  if (report.failures.length > 0) {
    lines.push('');
    lines.push('**未达标项**');
    lines.push('');
    for (const f of report.failures) lines.push(`- ✕ ${f}`);
  }
  lines.push('');
  lines.push('**能力边界**');
  lines.push('');
  lines.push('```');
  for (const note of report.notes) lines.push(note);
  lines.push('```');
  return lines.join('\n');
}
