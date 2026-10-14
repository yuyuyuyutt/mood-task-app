// src/features/plan-generator/__tests__/agentOrchestrator.test.ts
// P5（多角色协作）的测试：消息契约、Critic 的确定性校验与安全修正、自动作答的依据标注，
// 以及编排器在"模型可用 / 不可用 / 需要修正"三种情况下的降级行为。
import { afterEach, describe, expect, it } from 'vitest';
import {
  makeMessage,
  validatePayload,
  clarifyPayloadSchema,
  critiquePayloadSchema,
  type AgentMessage,
} from '../services/agent/agents/protocol';
import {
  critiquePlan,
  diffPlans,
  repairPlanByRules,
  summarizeCritique,
} from '../services/agent/agents/critic';
import { autoAnswerQuestions, runAgentPlan } from '../services/agent/agents';
import { generatePlan } from '../services/planGenerator';
import { VectorStore } from '../services/rag/vectorStore';
import { DEFAULT_LLM_CONFIG } from '../services/llmClient';
import { stubChatBySystem, MemoryVectorBackend } from './helpers/memoryVectorBackend';
import type { GeneratedPlan, HabitProfile, NetworkingSettings, PlanGenInput } from '../types';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const NOW = new Date('2026-09-28T12:00:00');

function input(overrides: Partial<PlanGenInput> = {}): PlanGenInput {
  return {
    goal: '学习 Python 基础',
    days: 3,
    planType: 'tasks',
    userType: 'balanced',
    preferences: {
      style: 'auto',
      availability: { start: '08:00', end: '22:00' },
      minutesPerDay: 60,
      includeWeekend: true,
    },
    ...overrides,
  };
}

function planWith(days: Array<{ date: string; tasks: Array<{ title: string; minutes: number }> }>): GeneratedPlan {
  return {
    id: 'p-test',
    goal: '学习 Python 基础',
    planType: 'tasks',
    userType: 'balanced',
    category: '学习',
    createdAt: NOW.toISOString(),
    engineVersion: 1,
    accepted: false,
    days: days.map((d) => ({
      date: d.date,
      tasks: d.tasks.map((t) => ({
        title: t.title,
        category: '学习' as const,
        estimatedMinutes: t.minutes,
      })),
    })),
    strategy: { methodology: ['间隔重复'], risks: ['贪多求快', '缺少反馈'], successCriteria: ['连续 7 天'] },
  };
}

const offSettings: NetworkingSettings = {
  bilibili: false,
  searxng: false,
  searxngBaseUrl: '',
  searxngEngines: [],
  jumpLinks: false,
  timeoutMs: 1000,
  preferredDifficulty: 'unknown',
};

// ---------------- 消息契约 ----------------

describe('protocol（结构化消息）', () => {
  it('makeMessage 带上来源、去向、类型、traceId 与时间', () => {
    const msg = makeMessage({
      from: 'critic',
      to: 'orchestrator',
      type: 'critique.report',
      payload: { ok: true },
      traceId: 'tr-1',
      at: NOW,
    });
    expect(msg).toMatchObject({ from: 'critic', to: 'orchestrator', type: 'critique.report' });
    expect(msg.traceId).toBe('tr-1');
    expect(msg.at).toBe(NOW.toISOString());
    expect(msg.id).toMatch(/^msg-\d+$/);
  });

  it('validatePayload：合法通过，非法给出可读的路径与原因', () => {
    const good = validatePayload(clarifyPayloadSchema, {
      questions: [{ id: 'q1', question: '每天能投入多久？' }],
      source: 'llm',
    });
    expect(good.ok).toBe(true);

    const bad = validatePayload(clarifyPayloadSchema, { questions: [{ id: '', question: 'x' }] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain('questions.0.id');

    const badSource = validatePayload(clarifyPayloadSchema, { questions: [], source: '猜的' });
    expect(badSource.ok).toBe(false);
  });

  it('critique 契约只接受白名单内的违规类型（防止下游出现未知分支）', () => {
    const invalid = validatePayload(critiquePayloadSchema, {
      ok: false,
      checked: 1,
      violations: [{ type: 'made_up_rule', detail: '?', severity: 'error' }],
    });
    expect(invalid.ok).toBe(false);
  });
});

// ---------------- Critic ----------------

describe('critic（确定性校验）', () => {
  it('逐条检查：项数 / 时长偏差 / 越界引用 / 风险条数 / 空天 / 证据未被引用', () => {
    const plan = planWith([
      { date: '2026-09-28', tasks: [{ title: '只一项', minutes: 30 }] }, // 项数不足
      { date: '2026-09-29', tasks: [{ title: '超时', minutes: 200 }] }, // 时长超限
      { date: '2026-09-30', tasks: [] }, // 空天
    ]);
    plan.days[0].tasks![0].resourceIds = ['不存在'];
    plan.strategy = { methodology: [], risks: ['只有一条'], successCriteria: [] };

    const report = critiquePlan({
      plan,
      minutesPerDay: 60,
      validResourceIds: new Set(['存在']),
      validEvidenceIds: new Set(['E1']),
    });

    const types = report.violations.map((v) => v.type);
    expect(types).toContain('items_per_day');
    expect(types).toContain('duration_sum');
    expect(types).toContain('empty_day');
    expect(types).toContain('missing_risk');
    expect(types.filter((t) => t === 'unknown_citation')).toHaveLength(1);
    // 注入了证据却一条都没被引用 → 提醒模型没读它
    expect(types).toContain('uncovered_evidence');
    expect(report.ok).toBe(false);
    expect(report.checked).toBeGreaterThanOrEqual(6);
  });

  it('合规计划通过校验；证据被引用时不产生 uncovered_evidence', () => {
    const plan = planWith([
      { date: '2026-09-28', tasks: [{ title: 'A', minutes: 30 }, { title: 'B', minutes: 30 }] },
      { date: '2026-09-29', tasks: [{ title: 'C', minutes: 30 }, { title: 'D', minutes: 30 }] },
    ]);
    plan.days[0].tasks![0].evidenceIds = ['E1'];

    const report = critiquePlan({ plan, minutesPerDay: 60, validEvidenceIds: new Set(['E1']) });
    expect(report.ok).toBe(true);
    expect(report.violations).toHaveLength(0);
    expect(summarizeCritique(report)).toContain('校验通过');
  });

  it('安全修正：只压缩超限时长，且守住每项 10 分钟下限', () => {
    const plan = planWith([
      { date: '2026-09-28', tasks: [{ title: 'A', minutes: 90 }, { title: 'B', minutes: 90 }] },
    ]);
    const { plan: fixed, diff, changed } = repairPlanByRules(plan, 60);

    expect(changed).toBe(true);
    const total = fixed.days[0].tasks!.reduce((s, t) => s + t.estimatedMinutes, 0);
    expect(total).toBeLessThanOrEqual(60);
    for (const task of fixed.days[0].tasks!) expect(task.estimatedMinutes).toBeGreaterThanOrEqual(10);
    expect(diff.changes[0].kind).toBe('minutes');
    expect(diff.changes[0].detail).toContain('180 → 60');
    expect(diff.changes[0].detail).toContain('2026-09-28');
    // 原计划不被原地修改
    expect(plan.days[0].tasks![0].estimatedMinutes).toBe(90);
  });

  it('时长已在容忍范围内时不改动', () => {
    const plan = planWith([
      { date: '2026-09-28', tasks: [{ title: 'A', minutes: 35 }, { title: 'B', minutes: 35 }] },
    ]);
    expect(repairPlanByRules(plan, 60).changed).toBe(false);
  });

  it('diffPlans 能识别时长 / 项数 / 策略变化', () => {
    const before = planWith([
      { date: '2026-09-28', tasks: [{ title: 'A', minutes: 60 }, { title: 'B', minutes: 30 }] },
    ]);
    const after = planWith([{ date: '2026-09-28', tasks: [{ title: 'A', minutes: 30 }] }]);
    after.strategy = { methodology: [], risks: ['新风险1', '新风险2'], successCriteria: [] };

    const diff = diffPlans(before, after);
    const kinds = diff.changes.map((c) => c.kind);
    expect(kinds).toContain('minutes');
    expect(kinds).toContain('items');
    expect(kinds).toContain('strategy');
    expect(diff.summary).toContain('处变更');
  });
});

// ---------------- 自动作答 ----------------

describe('autoAnswerQuestions（自答并标注依据）', () => {
  const questions = [
    { id: 'q1', question: '你目前的基础如何？', dimension: '现有基础' },
    { id: 'q2', question: '每天能投入多久？', dimension: '资源约束' },
    { id: 'q3', question: '怎么算达成目标？', dimension: '量化目标' },
    { id: 'q4', question: '还有什么想补充的吗？', dimension: '其他' },
  ];

  it('有画像/记忆时用事实回答，其余明确标为默认假设', () => {
    // 只构造 autoAnswer 真正读取的三个特征（完成率 / 平均耗时 / 高效时段），
    // 其余特征与本用例无关，因此用一次显式断言补成完整类型而不是硬凑一个假画像。
    const profile = {
      userType: 'balanced',
      dataWindowDays: 30,
      analyzedAt: NOW.toISOString(),
      features: {
        completionRate: 0.7,
        avgTaskDurationMinutes: 40,
        peakCompletionHour: 21,
      },
    } as unknown as HabitProfile;

    const answers = autoAnswerQuestions({
      questions,
      profile,
      memoryHits: [
        {
          note: {
            id: 'mem-1',
            kind: 'episodic',
            subjectKey: 'x',
            subject: '学 Python',
            summary: '已接受 3 天计划（6 项，日均 60 分钟）',
            evidence: [],
            confidence: 0.6,
            hitCount: 1,
            createdAt: NOW.toISOString(),
            lastUsedAt: NOW.toISOString(),
            stats: { completionRate: 0.45, accepted: true },
          },
          score: 0.8,
          scoreDetail: { category: 1, lexical: 0.5, confidence: 0.6, recency: 1 },
        },
      ],
      minutesPerDay: 60,
      days: 5,
      availability: { start: '08:00', end: '22:00' },
    });

    expect(answers).toHaveLength(4);
    expect(answers[0].basis).toBe('profile'); // 基础 ← 完成率
    expect(answers[0].answer).toContain('70%');
    expect(answers[1].basis).toBe('profile'); // 资源约束 ← 用户填的投入
    expect(answers[1].answer).toContain('60 分钟');
    expect(answers[2].basis).toBe('memory'); // 目标 ← 历史记忆
    expect(answers[2].answer).toContain('学 Python');
    expect(answers[3].basis).toBe('default'); // 无从推断 → 明确标为假设
  });

  it('没有画像与记忆时全部落到默认假设（不编事实）', () => {
    const answers = autoAnswerQuestions({
      questions,
      minutesPerDay: 30,
      days: 3,
      availability: { start: '09:00', end: '18:00' },
    });
    expect(answers.filter((a) => a.basis === 'default').length).toBeGreaterThanOrEqual(3);
    expect(answers.every((a) => a.answer.length > 0)).toBe(true);
  });
});

// ---------------- 编排器端到端 ----------------

describe('runAgentPlan', () => {
  function dates(): string[] {
    return generatePlan(input(), { now: NOW }).days.map((d) => d.date);
  }

  function llmPlanJson(minutes = 30): string {
    const [d1, d2, d3] = dates();
    return JSON.stringify({
      strategy: {
        methodology: ['间隔重复', '项目驱动'],
        risks: ['贪多求快', '缺少反馈'],
        successCriteria: ['连续 7 天完成'],
      },
      narrative: '先易后难，保持节奏。',
      days: [d1, d2, d3].map((date) => ({
        date,
        tasks: [
          { title: '装好环境', minutes, time: '09:00', reason: '先把环境问题排除', methodology: ['项目驱动'], resourceIds: [], evidenceIds: [] },
          { title: '练语法', minutes, time: '10:00', reason: '每天一小段', methodology: ['间隔重复'], resourceIds: [], evidenceIds: [] },
        ],
      })),
    });
  }

  const enabledConfig = { ...DEFAULT_LLM_CONFIG, enabled: true, model: 'qwen2.5:7b' };

  it('模型不可用 → 全链路降级：level=rule，但角色仍在跑、计划仍生成', async () => {
    const run = await runAgentPlan({
      input: input(),
      config: { ...DEFAULT_LLM_CONFIG, enabled: false },
      netSettings: offSettings,
      manualResources: [],
      scoreContext: { preferredDifficulty: 'unknown' },
      now: NOW,
    });

    expect(run.level).toBe('rule');
    expect(run.compose.source).toBe('rule');
    expect(run.roles).toContain('researcher');
    expect(run.roles).toContain('planner');
    expect(run.roles).toContain('critic');
    expect(run.answers.length).toBeGreaterThanOrEqual(3);
    expect(run.messages.length).toBeGreaterThanOrEqual(3);
    expect(run.critique.checked).toBeGreaterThan(0);
    expect(run.compose.plan.days).toHaveLength(3);
  });

  it('模型可用 → 四个角色跑通，level=multi，消息覆盖澄清/回答/证据/草稿/校验', async () => {
    const stub = stubChatBySystem([
      { match: '规划教练', response: JSON.stringify({ questions: [{ id: 'q1', question: '每天能投入多久？', why: '', kind: 'text', dimension: '资源约束' }] }) },
      { match: '信息检索专家', response: JSON.stringify({ keywords: [{ keyword: 'Python 入门', priority: 1, reason: '基础', lang: 'zh' }] }) },
      { match: '计划设计专家', response: llmPlanJson() },
    ]);

    const run = await runAgentPlan({
      input: input(),
      config: enabledConfig,
      netSettings: offSettings,
      manualResources: [],
      scoreContext: { preferredDifficulty: 'unknown' },
      now: NOW,
    });

    expect(run.level).toBe('multi');
    expect(run.roles).toEqual(['clarifier', 'researcher', 'planner', 'critic']);
    expect(run.compose.source).toBe('llm');
    const types = run.messages.map((m: AgentMessage<unknown>) => m.type);
    expect(types).toContain('clarify.questions');
    expect(types).toContain('clarify.answers');
    expect(types).toContain('evidence.pack');
    expect(types).toContain('plan.draft');
    expect(types).toContain('critique.report');
    expect(run.critique.ok).toBe(true);
    expect(stub.calls.filter((c) => c.system.includes('计划设计专家'))).toHaveLength(1);
  });

  it('计划违反硬约束 → Critic 触发确定性修正，并把 diff 记进报告', async () => {
    stubChatBySystem([
      { match: '规划教练', response: JSON.stringify({ questions: [], source: 'llm' }) },
      { match: '信息检索专家', response: JSON.stringify({ keywords: [{ keyword: 'Python', priority: 1, reason: '', lang: 'zh' }] }) },
      // 每天 2×30=60 分钟，而每日投入设成 20 → 必然超限
      { match: '计划设计专家', response: llmPlanJson(30) },
    ]);

    const run = await runAgentPlan({
      input: input({
        preferences: {
          style: 'auto',
          availability: { start: '08:00', end: '22:00' },
          minutesPerDay: 20,
          includeWeekend: true,
        },
      }),
      config: enabledConfig,
      netSettings: offSettings,
      manualResources: [],
      scoreContext: { preferredDifficulty: 'unknown' },
      now: NOW,
      /** 关掉模型修正轮，专门验证确定性修正这一级 */
      allowRepair: false,
    });

    expect(run.repair.applied).toBe(true);
    expect(run.repair.source).toBe('rule');
    expect(run.repair.rounds).toBe(1);
    expect(run.repair.diff.changes.length).toBeGreaterThan(0);
    expect(run.repair.diff.changes[0].detail).toMatch(/\d+ → \d+ 分钟/);
    for (const day of run.compose.plan.days) {
      const total = (day.tasks ?? []).reduce((s, t) => s + t.estimatedMinutes, 0);
      expect(total).toBeLessThanOrEqual(20);
    }
    // 修正后再校验：时长类问题已经消除
    expect(run.critique.violations.some((v) => v.type === 'duration_sum')).toBe(false);
  });

  it('开启正文抓取后，证据会进入计划，并作为引用白名单生效', async () => {
    const backend = new MemoryVectorBackend();
    const page = `<html><head><title>Python 入门</title></head><body><p>${'列表推导式的写法讲解。'.repeat(40)}</p></body></html>`;

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.startsWith('https://example.com')) {
        return new Response(page, { status: 200, headers: { 'Content-Type': 'text/html' } });
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        messages?: Array<{ role: string; content: string }>;
        input?: string[];
      };
      if (target.endsWith('/api/embed')) {
        return new Response(
          JSON.stringify({ embeddings: (body.input ?? []).map(() => [1, 0.05]) }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      const system = body.messages?.find((m) => m.role === 'system')?.content ?? '';
      if (system.includes('规划教练')) {
        return new Response(JSON.stringify({ message: { content: JSON.stringify({ questions: [] }) } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (system.includes('信息检索专家')) {
        return new Response(
          JSON.stringify({ message: { content: JSON.stringify({ keywords: [{ keyword: 'Python 入门', priority: 1, reason: '', lang: 'zh' }] }) } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      // 计划里引用 E1（真实存在的证据）与 E9（不存在的证据）
      const [d1, d2, d3] = dates();
      const plan = {
        strategy: { methodology: ['间隔重复'], risks: ['贪多求快', '缺少反馈'], successCriteria: ['连续 7 天'] },
        narrative: 'n',
        days: [d1, d2, d3].map((date, index) => ({
          date,
          tasks: [
            {
              title: `任务${index}`,
              minutes: 30,
              reason: '依据证据 E1',
              methodology: [],
              resourceIds: [],
              evidenceIds: index === 0 ? ['E1', 'E9'] : [],
            },
            { title: `任务${index}b`, minutes: 30, reason: '', methodology: [], resourceIds: [], evidenceIds: [] },
          ],
        })),
      };
      return new Response(JSON.stringify({ message: { content: JSON.stringify(plan) } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const run = await runAgentPlan({
      input: input(),
      config: enabledConfig,
      netSettings: offSettings,
      // 本地资源库条目：标题含 "Python" 才会被关键词命中，从而成为正文抓取的候选
      manualResources: [
        {
          id: 'm1',
          title: 'Python 入门',
          url: 'https://example.com/py',
          type: 'article',
          keywords: ['python'],
          createdAt: NOW.toISOString(),
        },
      ],
      scoreContext: { preferredDifficulty: 'unknown' },
      rag: {
        runtime: {
          store: new VectorStore(backend),
          config: { baseUrl: 'http://127.0.0.1:11434', model: 'nomic-embed-text', timeoutMs: 3000 },
        },
        goal: '学习 Python 列表推导式',
      },
      evidenceFetch: {
        enabled: true,
        allowedDomains: ['example.com'],
        maxResources: 1,
        maxChunks: 2,
        timeoutMs: 2000,
      },
      now: NOW,
    });

    expect(run.evidence.enabled).toBe(true);
    expect(run.evidence.chunks.length).toBeGreaterThan(0);
    expect(run.compose.plan.evidence?.length).toBeGreaterThan(0);
    // E9 不在证据清单里 → 被丢弃并计数，E1 保留
    const firstTask = run.compose.plan.days[0].tasks![0];
    expect(firstTask.evidenceIds).toEqual(['E1']);
    expect(run.compose.warnings.some((w) => w.includes('不在证据清单中'))).toBe(true);
  });
});
