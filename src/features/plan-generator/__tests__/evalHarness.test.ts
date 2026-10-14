// src/features/plan-generator/__tests__/evalHarness.test.ts
// 评测**工具本身**的测试。
//
// 为什么评测器也要测：如果指标口径或回放路由写错了，评测会给出"稳定的错误结论"，
// 那比没有评测更危险。这里专门守住三件事：指标边界、回放路由、以及
// "用例失败时不会把整轮评测搞崩"。
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_EVAL_THRESHOLDS,
  EVAL_CASES,
  formatMarkdown,
  formatReport,
  installReplayFetch,
  mean,
  percent,
  percentile,
  precision,
  pseudoEmbedding,
  rate,
  resolveScriptedText,
  round3,
  runEvalCase,
  runEvalSuite,
  safeRatio,
} from '../services/eval';
import { cosineSimilarity } from '../services/rag/embedding';
import type { EvalCase } from '../services/eval';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const caseById = (id: string): EvalCase => {
  const found = EVAL_CASES.find((c) => c.id === id);
  if (!found) throw new Error(`用例集里没有 ${id}`);
  return found;
};

// ---------------- 指标口径 ----------------

describe('metrics（指标口径与边界）', () => {
  it('safeRatio：分母为 0 时返回 fallback，而不是 NaN/Infinity', () => {
    expect(safeRatio(1, 2)).toBe(0.5);
    expect(safeRatio(0, 0)).toBe(1);
    expect(safeRatio(0, 0, 0)).toBe(0);
    expect(Number.isFinite(safeRatio(3, 0))).toBe(true);
  });

  it('precision：一条引用都没有算通过（1），全被丢弃算 0', () => {
    expect(precision(3, 0)).toBe(1);
    expect(precision(0, 2)).toBe(0);
    expect(precision(1, 1)).toBe(0.5);
  });

  it('percentile 用最近秩，样本少时不会给出不存在的分位值', () => {
    expect(percentile([], 95)).toBe(0);
    expect(percentile([10], 95)).toBe(10);
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
    expect(percentile([10, 20, 30, 40], 100)).toBe(40);
  });

  it('mean / rate / round3 / percent', () => {
    expect(mean([])).toBe(0);
    expect(mean([1, 2, 3])).toBe(2);
    expect(rate([true, true, false])).toBeCloseTo(0.6667, 3);
    expect(rate([])).toBe(1);
    expect(round3(0.6666666)).toBe(0.667);
    expect(percent(0.5)).toBe('50.0%');
  });
});

// ---------------- 回放层 ----------------

describe('replay（脚本回放）', () => {
  const context = {
    goal: '学习 Python',
    days: 3,
    minutesPerDay: 60,
    dates: ['2026-09-28', '2026-09-29', '2026-09-30'],
    resourceIds: ['manual:abc'],
  };

  it('按 system 提示把请求路由到阶段，并把脚本消费掉', async () => {
    const replay = installReplayFetch(
      {
        clarify: [{ text: '{"questions":[]}' }],
        keywords: [{ text: '{"keywords":[]}' }],
        plan: [{ text: '{"days":[]}' }, { text: '{"days":[]}' }],
      },
      context,
    );
    try {
      const chat = async (system: string) => {
        const res = await fetch('http://127.0.0.1:11434/api/chat', {
          method: 'POST',
          body: JSON.stringify({ messages: [{ role: 'system', content: system }, { role: 'user', content: 'u' }] }),
        });
        return (await res.json()) as { message: { content: string } };
      };
      expect((await chat('你是资深的学习/健身/项目规划教练。')).message.content).toBe('{"questions":[]}');
      expect((await chat('你是信息检索专家。')).message.content).toBe('{"keywords":[]}');
      expect((await chat('你是严谨的计划设计专家。')).message.content).toBe('{"days":[]}');
      // 修正轮用的是同一个 system，靠 user 里的固定措辞区分
      const repair = await fetch('http://127.0.0.1:11434/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: [
            { role: 'system', content: '你是严谨的计划设计专家。' },
            { role: 'user', content: '当前计划存在以下问题，请逐条修掉' },
          ],
        }),
      });
      expect(repair.status).toBe(200);
      expect(replay.countOf('clarify')).toBe(1);
      expect(replay.countOf('keywords')).toBe(1);
      // 首轮计划与"修正轮"共用一个 system，但被识别成两个不同的阶段
      expect(replay.countOf('plan')).toBe(1);
      expect(replay.countOf('repair')).toBe(1);
    } finally {
      replay.restore();
    }
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it('脚本里的错误响应会被如实返回（用于验证降级链）', async () => {
    const replay = installReplayFetch({ clarify: [{ status: 500, body: 'boom' }] }, context);
    try {
      const res = await fetch('http://127.0.0.1:11434/api/chat', {
        method: 'POST',
        body: JSON.stringify({ messages: [{ role: 'system', content: '你是资深的学习/健身/项目规划教练。' }] }),
      });
      expect(res.status).toBe(500);
    } finally {
      replay.restore();
    }
  });

  it('未注册的 system 提示直接报错，避免"漏发请求"被误判成正常', async () => {
    const replay = installReplayFetch({ clarify: [{ text: '{}' }] }, context);
    try {
      await expect(
        fetch('http://127.0.0.1:11434/api/chat', {
          method: 'POST',
          body: JSON.stringify({ messages: [{ role: 'system', content: '你是谁？' }] }),
        }),
      ).rejects.toThrow('未注册的 system 提示');
    } finally {
      replay.restore();
    }
  });

  it('正文夹具按 URL 前缀命中；未注册的外部请求返回 404 而不是挂住', async () => {
    const replay = installReplayFetch(
      { pages: { 'https://example.com/py': '<html><body><p>正文</p></body></html>' } },
      context,
    );
    try {
      const page = await fetch('https://example.com/py');
      expect(await page.text()).toContain('正文');
      const other = await fetch('https://other.com/x');
      expect(other.status).toBe(404);
      expect(replay.countOf('page')).toBe(1);
      expect(replay.countOf('unmatched')).toBe(1);
    } finally {
      replay.restore();
    }
  });

  it('embedding 走确定性伪向量：共享词更多 → 余弦更高', async () => {
    const replay = installReplayFetch({}, context);
    try {
      const res = await fetch('http://127.0.0.1:11434/api/embed', {
        method: 'POST',
        body: JSON.stringify({ input: ['Python 入门 基础', '烹饪 蛋糕 黄油'], model: 'x' }),
      });
      const data = (await res.json()) as { embeddings: number[][] };
      const query = pseudoEmbedding('Python 入门 基础');
      expect(cosineSimilarity(query, data.embeddings[0])).toBeGreaterThan(
        cosineSimilarity(query, data.embeddings[1]),
      );
      // 同一文本两次向量化必须一致（确定性是评测可复现的前提）
      expect(pseudoEmbedding('Python 入门')).toEqual(pseudoEmbedding('Python 入门'));
    } finally {
      replay.restore();
    }
  });

  it('脚本支持函数形态，从而引用本次运行的日期白名单', () => {
    expect(resolveScriptedText((ctx) => ctx.dates.join(','), context)).toBe(
      '2026-09-28,2026-09-29,2026-09-30',
    );
    expect(resolveScriptedText('静态文本', context)).toBe('静态文本');
  });
});

// ---------------- 用例执行 ----------------

describe('runEvalCase（真实链路上的断言）', () => {
  it('正常用例：零降级、引用精度 100%', async () => {
    const result = await runEvalCase(caseById('happy-path'));
    expect(result.error).toBeUndefined();
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);
    expect(result.observation?.fallbacks).toBe(0);
    expect(result.observation?.citationPrecision).toBe(1);
    expect(result.observation?.citations.resourcesKept).toBeGreaterThan(0);
    expect(result.observation?.planDays).toBe(3);
  });

  it('对抗用例：编造的引用被白名单丢掉，且计划里确实没有它', async () => {
    const result = await runEvalCase(caseById('hallucinated-citations'));
    expect(result.passed).toBe(true);
    expect(result.observation?.citations.resourcesDropped).toBe(2);
    expect(result.observation?.citations.resourcesKept).toBe(0);
    expect(result.observation?.citationPrecision).toBe(0);
  });

  it('降级用例：模型全挂时走规则生成器，且降级原因被记录（不是静默）', async () => {
    const result = await runEvalCase(caseById('model-down'));
    expect(result.passed).toBe(true);
    expect(result.observation?.source).toBe('rule');
    expect(result.observation?.fallbacks).toBeGreaterThanOrEqual(3);
    expect(result.observation?.fallbackStages).toEqual(
      expect.arrayContaining(['clarify', 'keywords', 'plan']),
    );
    expect(result.observation?.strategyRisks).toBeGreaterThanOrEqual(2);
  });

  it('agent 用例：四个角色跑通并判定为 multi', async () => {
    const result = await runEvalCase(caseById('agent-multi'));
    expect(result.passed).toBe(true);
    expect(result.observation?.level).toBe('multi');
    expect(result.observation?.roles).toHaveLength(4);
  });

  it('adjust 用例：确认令牌提交后计划真的变了', async () => {
    const result = await runEvalCase(caseById('tool-adjust-shift'));
    expect(result.passed).toBe(true);
    expect(result.observation?.toolCommitted).toBe(true);
    expect(result.observation?.toolCalls.ok).toBeGreaterThanOrEqual(1);
  });

  it('期望不满足时给出可读的失败原因，而不是抛异常', async () => {
    const broken: EvalCase = {
      ...caseById('happy-path'),
      id: 'broken-expectation',
      expect: { source: 'rule', days: 99, minCitationPrecision: 2 },
    };
    const result = await runEvalCase(broken);
    expect(result.passed).toBe(false);
    expect(result.error).toBeUndefined();
    expect(result.failures.join('｜')).toContain('计划来源');
    expect(result.failures.join('｜')).toContain('计划天数');
    expect(result.failures.join('｜')).toContain('引用精度');
    // 用例可以共享同一份脚本，但 globalThis.fetch 必须被还原
    expect(globalThis.fetch).toBe(originalFetch);
  });
});

// ---------------- 整套评测 ----------------

describe('runEvalSuite（门禁与报告）', () => {
  it('默认阈值下整套通过，并产出六个可复核的指标', async () => {
    const report = await runEvalSuite();
    expect(report.ok).toBe(true);
    expect(report.failures).toEqual([]);
    expect(report.cases).toHaveLength(EVAL_CASES.length);
    expect(report.metrics.caseCount).toBe(EVAL_CASES.length);
    expect(report.metrics.adversarialCaseCount).toBeGreaterThanOrEqual(2);
    expect(report.metrics.schemaPassRate).toBeGreaterThanOrEqual(DEFAULT_EVAL_THRESHOLDS.schemaPassRate);
    expect(report.metrics.degradationRate).toBeLessThanOrEqual(DEFAULT_EVAL_THRESHOLDS.maxDegradationRate);
    expect(report.metrics.p95LatencyMs).toBeGreaterThanOrEqual(0);
    expect(report.metrics.meanSteps).toBeGreaterThan(0);
  }, 30_000);

  it('阈值不可达时给出"未达标项"，而不是静默通过', async () => {
    const report = await runEvalSuite({
      cases: [caseById('model-down')],
      thresholds: { ...DEFAULT_EVAL_THRESHOLDS, passRate: 1, maxDegradationRate: 0 },
    });
    expect(report.ok).toBe(false);
    expect(report.failures.join('｜')).toContain('降级用例比例');
  }, 15_000);

  it('报告能把指标、用例与边界说明都渲染出来', async () => {
    const report = await runEvalSuite({ cases: [caseById('happy-path')] });
    const text = formatReport(report);
    expect(text).toContain('离线评测报告');
    expect(text).toContain('引用精度');
    expect(text).toContain('happy-path');
    expect(text).toContain('不联网、不需要本地模型');

    const md = formatMarkdown(report);
    expect(md).toContain('| 指标 | 数值 |');
    expect(md).toContain('| 用例 | 模式 | 结果 |');
    expect(md).toContain('能力边界');
  }, 15_000);
});
