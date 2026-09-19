// src/features/plan-generator/__tests__/planComposer.test.ts
// 阶段 3 测试：JSON 容错、引用校验（防编造）、策略补齐、以及 LLM 失败回退规则生成器。
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  composePlan,
  enrichPlanByRules,
  enrichPlanWithExtras,
  normalizeStrategy,
  parsePlanV2Json,
} from '../services/planComposer';
import { generatePlan } from '../services/planGenerator';
import { DEFAULT_LLM_CONFIG, type LLMConfig } from '../services/llmClient';
import type { ClarificationAnswer, ResourceBundle, ResourceItem } from '../types';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const NOW = new Date('2025-04-01T10:00:00');
const rulePlan = generatePlan(
  { goal: '学习 Python', days: 3, planType: 'tasks', userType: 'balanced' },
  { now: NOW, id: 'p1' },
);

const resources: ResourceItem[] = [
  {
    id: 'bilibili:aaa',
    source: 'bilibili',
    layer: 1,
    type: 'video',
    title: 'Python 入门 12 讲',
    url: 'https://www.bilibili.com/video/BV1',
    durationMinutes: 12,
    keyword: 'Python 入门',
    score: 0.8,
  },
  {
    id: 'searxng:bbb',
    source: 'searxng',
    layer: 2,
    type: 'article',
    title: '官方文档：Python 教程',
    url: 'https://docs.python.org/zh-cn/3/tutorial/',
    keyword: 'Python 文档',
    score: 0.7,
  },
];

const bundle: ResourceBundle = {
  items: resources,
  grouped: { video: [resources[0]], article: [resources[1]], book: [], post: [], link: [] },
  byKeyword: [{ keyword: 'Python 入门', items: resources }],
  jumpGroups: [
    { keyword: 'Python 入门', links: [{ platform: 'bilibili', label: 'B 站', url: 'https://x' }] },
  ],
  layers: [
    { layer: 1, enabled: true, ok: true, count: 1 },
    { layer: 2, enabled: true, ok: true, count: 1 },
    { layer: 3, enabled: true, ok: true, count: 6 },
  ],
  warnings: [],
};

const answers: ClarificationAnswer[] = [
  { id: 'q1', question: '每天能投入多久？', answer: '约 1 小时' },
  { id: 'q2', question: '基础如何？', answer: '完全零基础' },
];

const enabledConfig: LLMConfig = { ...DEFAULT_LLM_CONFIG, enabled: true, model: 'qwen2.5:7b' };

function stubOllama(responseText: string, ok = true, status = 200): void {
  globalThis.fetch = vi.fn(async () =>
    ok
      ? new Response(JSON.stringify({ response: responseText }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      : new Response('boom', { status }),
  ) as unknown as typeof fetch;
}

describe('parsePlanV2Json', () => {
  it('解析完整结构（策略 + 任务理由 + 方法论 + 资源引用）', () => {
    const raw = parsePlanV2Json(
      JSON.stringify({
        strategy: {
          methodology: ['间隔重复'],
          risks: ['风险一', '风险二'],
          successCriteria: ['能独立完成小项目'],
        },
        narrative: '先打基础',
        days: [
          {
            date: rulePlan.days[0].date,
            tasks: [
              {
                title: '安装环境',
                minutes: 20,
                time: '09:00',
                reason: '先跑通环境减少后续阻力',
                methodology: ['番茄工作法'],
                resourceIds: ['bilibili:aaa'],
              },
            ],
          },
        ],
      }),
    );
    expect(raw.strategy?.risks).toHaveLength(2);
    expect(raw.days[0].tasks[0].reason).toContain('环境');
    expect(raw.days[0].tasks[0].resourceIds).toEqual(['bilibili:aaa']);
  });

  it('夹紧超范围时长、丢弃非法日期与空标题', () => {
    const raw = parsePlanV2Json(
      JSON.stringify({
        days: [
          { date: 'not-a-date', tasks: [{ title: 'x', minutes: 30 }] },
          {
            date: rulePlan.days[0].date,
            tasks: [
              { title: '过短', minutes: 1 },
              { title: '过长', minutes: 999 },
              { title: '', minutes: 30 },
            ],
          },
        ],
      }),
    );
    expect(raw.days).toHaveLength(1);
    expect(raw.days[0].tasks.map((t) => t.minutes)).toEqual([10, 180]);
  });

  it('无有效日程时抛错（触发规则回退）', () => {
    expect(() => parsePlanV2Json('{"days":[]}')).toThrow();
    expect(() => parsePlanV2Json('not json at all')).toThrow();
  });
});

describe('normalizeStrategy（风险 ≥2 条为硬性要求）', () => {
  it('风险不足 2 条时从模板补齐', () => {
    const s = normalizeStrategy(
      { methodology: ['A'], risks: ['只有一条'], successCriteria: [] },
      '学习',
      7,
    );
    expect(s.risks.length).toBeGreaterThanOrEqual(2);
    expect(s.successCriteria.length).toBeGreaterThan(0);
    expect(s.methodology).toEqual(['A']);
  });

  it('完全没有策略时使用完整模板', () => {
    const s = normalizeStrategy(undefined, '健身', 14);
    expect(s.methodology.length).toBeGreaterThanOrEqual(3);
    expect(s.risks.length).toBeGreaterThanOrEqual(2);
    expect(s.successCriteria.length).toBeGreaterThanOrEqual(3);
  });
});

describe('enrichPlanWithExtras（防编造引用）', () => {
  it('丢弃不在资源列表内的 resourceIds 并记录数量', () => {
    const raw = parsePlanV2Json(
      JSON.stringify({
        days: [
          {
            date: rulePlan.days[0].date,
            tasks: [
              {
                title: '任务A',
                minutes: 30,
                reason: '理由A',
                methodology: ['费曼技巧'],
                resourceIds: ['bilibili:aaa', 'made-up:123'],
              },
            ],
          },
        ],
      }),
    );
    const { plan, droppedCitations } = enrichPlanWithExtras(
      rulePlan,
      raw,
      new Set(resources.map((r) => r.id)),
    );
    expect(droppedCitations).toBe(1);
    expect(plan.days[0].tasks![0].resourceIds).toEqual(['bilibili:aaa']);
    expect(plan.days[0].tasks![0].reason).toBe('理由A');
    expect(plan.days[0].tasks![0].methodology).toEqual(['费曼技巧']);
  });
});

describe('enrichPlanByRules（规则兜底也带理由与引用）', () => {
  it('为每个任务补上理由/方法论/资源', () => {
    const strategy = normalizeStrategy(undefined, '学习', 3);
    const plan = enrichPlanByRules(rulePlan, strategy, resources);
    for (const day of plan.days) {
      for (const task of day.tasks ?? []) {
        expect(task.reason && task.reason.length).toBeGreaterThan(4);
        expect(task.methodology?.length).toBeGreaterThan(0);
        expect(task.resourceIds?.length).toBe(1);
      }
    }
  });
});

describe('composePlan（含降级）', () => {
  it('AI 未开启 → 规则生成器 + 策略 + 资源引用（计划仍可生成）', async () => {
    const res = await composePlan({
      input: { goal: '学习 Python', days: 3, planType: 'tasks', userType: 'balanced' },
      answers,
      resources: bundle,
      config: DEFAULT_LLM_CONFIG,
      now: NOW,
    });
    expect(res.source).toBe('rule');
    expect(res.plan.generation?.source).toBe('rule');
    expect(res.plan.strategy!.risks.length).toBeGreaterThanOrEqual(2);
    expect(res.plan.resources).toHaveLength(2);
    expect(res.plan.clarifications).toHaveLength(2);
    expect(res.plan.days[0].tasks![0].reason).toBeTruthy();
  });

  it('AI 成功 → 采用模型计划、保留理由/方法论/引用，并写入策略', async () => {
    stubOllama(
      JSON.stringify({
        strategy: {
          methodology: ['项目驱动'],
          risks: ['风险一', '风险二'],
          successCriteria: ['完成 1 个小项目'],
        },
        narrative: '先环境后语法',
        days: [
          {
            date: rulePlan.days[0].date,
            tasks: [
              {
                title: '装好 Python 环境',
                minutes: 30,
                time: '09:00',
                reason: '零基础先排除环境问题',
                methodology: ['番茄工作法'],
                resourceIds: ['bilibili:aaa'],
              },
              {
                title: '写第一个脚本',
                minutes: 40,
                time: '10:00',
                reason: '立刻获得正反馈',
                methodology: ['项目驱动'],
                resourceIds: ['searxng:bbb', 'fabricated:zzz'],
              },
            ],
          },
        ],
      }),
    );

    const res = await composePlan({
      input: { goal: '学习 Python', days: 3, planType: 'tasks', userType: 'balanced' },
      answers,
      resources: bundle,
      config: enabledConfig,
      now: NOW,
    });

    expect(res.source).toBe('llm');
    expect(res.plan.days[0].tasks![0].title).toBe('装好 Python 环境');
    expect(res.plan.days[0].tasks![0].reason).toBe('零基础先排除环境问题');
    // 编造的引用被剔除，只保留真实资源
    expect(res.plan.days[0].tasks![1].resourceIds).toEqual(['searxng:bbb']);
    expect(res.warnings.join(' ')).toContain('防止编造链接');
    expect(res.plan.strategy!.methodology).toEqual(['项目驱动']);
    // 未覆盖的日期保留规则计划
    expect(res.plan.days).toHaveLength(3);
  });

  it('AI 失败（HTTP 500）→ 回退规则生成器并给出原因', async () => {
    stubOllama('', false, 500);
    const res = await composePlan({
      input: { goal: '学习 Python', days: 3, planType: 'tasks', userType: 'balanced' },
      answers,
      resources: bundle,
      config: enabledConfig,
      now: NOW,
    });
    expect(res.source).toBe('rule');
    expect(res.plan.generation?.source).toBe('rule');
    expect(res.plan.generation?.warnings.join(' ')).toMatch(/失败|500/);
    expect(res.plan.days[0].tasks!.length).toBeGreaterThan(0);
  });

  it('AI 返回不可解析内容 → 回退规则生成器', async () => {
    stubOllama('我不会输出 JSON。');
    const res = await composePlan({
      input: { goal: '学习 Python', days: 3, planType: 'tasks', userType: 'balanced' },
      answers,
      resources: bundle,
      config: enabledConfig,
      now: NOW,
    });
    expect(res.source).toBe('rule');
    expect(res.warnings.join(' ')).toContain('回退规则生成器');
  });

  it('事件形态（events）同样支持 AI 计划与资源引用', async () => {
    stubOllama(
      JSON.stringify({
        days: [
          {
            date: rulePlan.days[0].date,
            tasks: [
              {
                title: '晨间学习块',
                minutes: 90,
                time: '09:00',
                reason: '整块时间做难点',
                resourceIds: ['bilibili:aaa'],
              },
            ],
          },
        ],
      }),
    );
    const res = await composePlan({
      input: { goal: '学习 Python', days: 2, planType: 'events', userType: 'long_focus' },
      answers,
      resources: bundle,
      config: enabledConfig,
      now: NOW,
    });
    expect(res.plan.planType).toBe('events');
    const firstEvent = res.plan.days[0].events?.[0];
    expect(firstEvent?.startTime).toBe('09:00');
    expect(firstEvent?.endTime).toBe('10:30');
    expect(res.plan.strategy!.risks.length).toBeGreaterThanOrEqual(2);
    expect(res.plan.resources).toHaveLength(2);
  });
});
