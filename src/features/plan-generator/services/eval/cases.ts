// src/features/plan-generator/services/eval/cases.ts
// 固定用例集：每条用例都是一段**脚本化的模型响应** + 一组可判定的期望。
//
// 选题标准：只写"能被断言、且断言背后是产品承诺"的用例。当前 7 条分别守住：
//   1) 正常链路不降级；
//   2) 编造的引用一定被白名单拦住；
//   3) 服务端拒绝 JSON Schema 时能自动降级重试并留下痕迹；
//   4) 模型整个挂掉时仍产出完整合法的计划（AI 是增益不是依赖）；
//   5) 正文证据能进 prompt，且证据引用同样受白名单约束；
//   6) 多角色协作跑通并判定为 multi 级别；
//   7) 工具调用的"决策 → 过闸门 → 确认令牌提交"整条链路可用。
//
// 刻意**不写**的：模型生成质量、语义召回质量、文案好坏。那需要真模型 + 人工评分，
// 塞进 CI 只会变成不稳定指标（本模块在报告头部声明了这个边界）。
import type { EvalCase, ScriptedContext } from './types';

/** 一段够长、可被切成多块、且"只讲一个主题"的正文（用于证据用例） */
export function pageFixture(topic: string, noise: string): string {
  return [
    '<html><head><title>评测夹具页面</title></head><body>',
    `<p>${`${topic}。`.repeat(40)}</p>`,
    `<p>${`${noise}。`.repeat(40)}</p>`,
    '</body></html>',
  ].join('');
}

export interface PlanFixtureParams {
  dates: string[];
  /** 每天几项（默认 2） */
  tasksPerDay?: number;
  /** 每项分钟数（默认 30；2 项 = 60，正好等于默认每日投入） */
  minutes?: number;
  /** 只给"第 0 天第 0 项"附加引用，便于精确断言白名单的放行与丢弃 */
  firstTask?: { resourceIds?: string[]; evidenceIds?: string[]; reason?: string };
  /** 风险条数（默认 2，满足硬性要求 ≥2） */
  risks?: number;
}

/** 生成符合 `parsePlanV2Json` 契约的计划 JSON 文本 */
export function planFixture(params: PlanFixtureParams): string {
  const { dates, tasksPerDay = 2, minutes = 30, firstTask, risks = 2 } = params;
  const riskList = Array.from({ length: risks }, (_, i) => `风险提示 ${i + 1}`);
  const days = dates.map((date, dayIndex) => ({
    date,
    tasks: Array.from({ length: tasksPerDay }, (_, taskIndex) => {
      const isFirst = dayIndex === 0 && taskIndex === 0;
      return {
        title: `第${dayIndex + 1}天任务${taskIndex + 1}`,
        minutes,
        time: `0${9 + taskIndex}:00`.slice(-5),
        reason: isFirst && firstTask?.reason ? firstTask.reason : '按节奏推进',
        methodology: ['间隔重复'],
        resourceIds: isFirst ? (firstTask?.resourceIds ?? []) : [],
        evidenceIds: isFirst ? (firstTask?.evidenceIds ?? []) : [],
      };
    }),
  }));

  return JSON.stringify({
    strategy: {
      methodology: ['间隔重复', '项目驱动'],
      risks: riskList,
      successCriteria: ['按天完成率 ≥ 70%'],
    },
    narrative: '先易后难，保持节奏。',
    days,
  });
}

/** 合法的澄清输出：解析器要求 ≥3 个问题，少于就会被判为"不可用"并降级 */
const CLARIFY_OK = JSON.stringify({
  questions: [
    { id: 'q1', question: '做到什么程度算达成？', why: '', kind: 'text', dimension: '量化目标' },
    { id: 'q2', question: '目前的基础如何？', why: '', kind: 'text', dimension: '现有基础' },
    { id: 'q3', question: '每天能投入多久？', why: '', kind: 'text', dimension: '资源约束' },
  ],
});

/** 合法的关键词输出：解析器要求 ≥2 个；三条都含 python，保证本地资源库能被命中 */
const KEYWORDS_OK = JSON.stringify({
  keywords: [
    { keyword: 'Python 入门', priority: 1, reason: '基础缺口', lang: 'zh' },
    { keyword: 'Python 练习', priority: 2, reason: '巩固语法', lang: 'zh' },
    { keyword: 'Python 项目', priority: 3, reason: '项目驱动', lang: 'zh' },
  ],
});

const PYTHON_RESOURCE = {
  id: 'm1',
  title: 'Python 入门',
  url: 'https://example.com/py',
  type: 'article' as const,
  keywords: ['python'],
  createdAt: '2026-09-01T00:00:00.000Z',
};

export const EVAL_CASES: EvalCase[] = [
  {
    id: 'happy-path',
    title: '正常链路：三阶段全部由模型完成，引用合法',
    rationale: '守住"零降级、零丢弃"的基线；一旦这条红了，说明改动影响了主路径。',
    mode: 'pipeline',
    goal: '学习 Python 基础',
    days: 3,
    manualResources: [PYTHON_RESOURCE],
    script: {
      clarify: [{ text: CLARIFY_OK }],
      keywords: [{ text: KEYWORDS_OK }],
      plan: [
        {
          text: ({ dates, resourceIds }: ScriptedContext) =>
            planFixture({ dates, firstTask: { resourceIds: resourceIds.slice(0, 1) } }),
        },
      ],
    },
    expect: {
      source: 'llm',
      maxFallbacks: 0,
      minCitationPrecision: 1,
      minConstraintRate: 1,
      days: 3,
      schemaApplied: true,
    },
  },
  {
    id: 'hallucinated-citations',
    title: '模型编造资源引用 → 白名单全部丢弃并计数',
    rationale:
      '守住"引用级防幻觉"：模型给出不存在的资源 id 时，计划里绝不能出现它，且必须能被指标看到（precision < 1）。',
    mode: 'pipeline',
    goal: '学习 Python 基础',
    days: 2,
    manualResources: [PYTHON_RESOURCE],
    script: {
      clarify: [{ text: CLARIFY_OK }],
      keywords: [{ text: KEYWORDS_OK }],
      plan: [
        {
          text: ({ dates }: ScriptedContext) =>
            planFixture({
              dates,
              firstTask: { resourceIds: ['bilibili:不存在的视频', 'book:编造的书名'] },
            }),
        },
      ],
    },
    expect: {
      source: 'llm',
      maxFallbacks: 0,
      minCitationPrecision: 0,
      minDroppedCitations: 2,
      minConstraintRate: 1,
      days: 2,
    },
  },
  {
    id: 'schema-rejected',
    title: '服务端拒绝 JSON Schema → 自动去约束重试，计划仍由模型产出',
    rationale:
      '守住降级链的第一级：老版本 Ollama 不支持 format schema 时要能重试成功，而不是直接掉到规则生成器。',
    mode: 'pipeline',
    goal: '学习 Python 基础',
    days: 2,
    manualResources: [PYTHON_RESOURCE],
    script: {
      clarify: [{ text: CLARIFY_OK }],
      keywords: [{ text: KEYWORDS_OK }],
      plan: [{ status: 400, body: 'schema not supported' }, { text: ({ dates }) => planFixture({ dates }) }],
    },
    expect: {
      source: 'llm',
      schemaApplied: false,
      minConstraintRate: 1,
      days: 2,
    },
  },
  {
    id: 'model-down',
    title: '模型全程不可用 → 计划仍完整合法（AI 是增益不是依赖）',
    rationale:
      '守住产品底线：模型挂了不能让功能不可用。期望规则生成器接手，且风险提示被补齐到 ≥2 条。',
    mode: 'pipeline',
    goal: '学习 Python 基础',
    days: 3,
    manualResources: [PYTHON_RESOURCE],
    script: {
      clarify: [{ status: 500, body: 'boom' }],
      keywords: [{ status: 500, body: 'boom' }],
      plan: [{ status: 500, body: 'boom' }],
    },
    expect: {
      source: 'rule',
      // 澄清 / 关键词 / 计划三处都应有降级记录
      maxFallbacks: 6,
      minConstraintRate: 1,
      days: 3,
    },
  },
  {
    id: 'evidence-injection',
    title: '正文证据进 prompt，且证据引用同样受白名单约束',
    rationale:
      '守住内容级 RAG 的两个承诺：①只有白名单域名的正文会被抓取并注入；②模型引用不存在的证据编号时同样被丢弃。',
    mode: 'pipeline',
    goal: '学习 Python 列表推导式',
    days: 2,
    minutesPerDay: 60,
    manualResources: [PYTHON_RESOURCE],
    allowedDomains: ['example.com'],
    script: {
      clarify: [{ text: CLARIFY_OK }],
      keywords: [{ text: KEYWORDS_OK }],
      plan: [
        {
          // 只引用证据：E1 存在（本次注入过），E9 不存在（编造）
          text: ({ dates }: ScriptedContext) =>
            planFixture({
              dates,
              firstTask: { evidenceIds: ['E1', 'E9'], reason: '依据证据 E1' },
            }),
        },
      ],
      pages: {
        'https://example.com/py': pageFixture(
          'Python 入门 基础 学习 列表推导式 练习',
          '烹饪 蛋糕 黄油 面粉 烘焙',
        ),
      },
    },
    expect: {
      source: 'llm',
      minEvidence: 1,
      minDroppedEvidence: 1,
      minCitationPrecision: 0.5,
      minConstraintRate: 1,
      days: 2,
    },
  },
  {
    id: 'agent-multi',
    title: '多角色协作：四角色跑通，判定为 multi 级别',
    rationale:
      '守住编排器的级别判定与角色可见性：澄清 → 检索 → 规划 → 校验 四个角色都跑通时必须是 multi，而不是悄悄退化成单 Agent。',
    mode: 'agent',
    goal: '学习 Python 基础',
    days: 3,
    manualResources: [PYTHON_RESOURCE],
    script: {
      clarify: [{ text: CLARIFY_OK }],
      keywords: [{ text: KEYWORDS_OK }],
      plan: [
        {
          text: ({ dates, resourceIds }: ScriptedContext) =>
            planFixture({ dates, firstTask: { resourceIds: resourceIds.slice(0, 1) } }),
        },
      ],
    },
    expect: {
      source: 'llm',
      level: 'multi',
      minRoles: 4,
      minCitationPrecision: 1,
      minConstraintRate: 1,
      days: 3,
    },
  },
  {
    id: 'tool-adjust-shift',
    title: '工具调用：模型决策 → 过闸门 → 确认令牌提交后计划真的变了',
    rationale:
      '守住 Skill 体系端到端可用：一次性确认令牌提交后，计划的日期必须整体顺延，而不是"看起来成功了但没生效"。',
    mode: 'adjust',
    goal: '学习 Python 基础',
    days: 3,
    manualResources: [PYTHON_RESOURCE],
    instruction: '整周顺延 2 天',
    script: {
      clarify: [{ text: CLARIFY_OK }],
      keywords: [{ text: KEYWORDS_OK }],
      plan: [
        {
          text: ({ dates, resourceIds }: ScriptedContext) =>
            planFixture({ dates, firstTask: { resourceIds: resourceIds.slice(0, 1) } }),
        },
      ],
      toolCall: [
        { text: JSON.stringify({ tool: 'shift_plan_days', args: { days: 2 }, reply: '整体顺延 2 天' }) },
      ],
    },
    expect: {
      source: 'llm',
      toolCallsOk: 1,
      toolCommitted: true,
      minConstraintRate: 1,
      days: 3,
    },
  },
];
