// src/features/plan-generator/services/prompts.ts
// 所有 LLM 提示词集中管理（便于迭代与审计）。
// 每个提示词都明确：角色、输入、硬性约束、输出 JSON 契约。
import type {
  HabitProfile,
  NetworkingSettings,
  PlanGenInput,
  ResourceItem,
  SearchKeyword,
} from '../types';

/** 澄清问答（只需 question/answer 两个字段，便于宽松复用） */
export interface QAPair {
  question: string;
  answer: string;
}

/** 统一的 JSON-only 结尾约束 */
const JSON_ONLY = '只输出 JSON，不要任何解释文字，不要 Markdown 代码块。';

const USER_TYPE_HINT: Record<string, string> = {
  morning_person: '晨型高效（重要任务放 08:00–10:00）',
  night_owl: '夜猫子（重要任务放 20:00–22:00）',
  fragmented: '碎片时间利用者（适合 20–30 分钟小块）',
  long_focus: '长块专注者（适合 1–2 小时连续块）',
  weekend_worker: '周末工作者（周末可承担与工作日相当的量）',
  regular: '规律执行者（固定时段、可适度加量）',
  balanced: '均衡型（上下午各一段）',
};

export function userTypeHint(userType: string): string {
  return USER_TYPE_HINT[userType] ?? userType;
}

// ============ 阶段 1：澄清问题 ============

export function buildClarifyPrompt(goal: string, days: number, userType: string): string {
  return [
    '你是资深的学习/健身/项目规划教练。用户给出了目标和计划天数，请提出 3–5 个【强相关】的澄清问题，',
    '以便生成真正可执行的个性化计划。',
    '',
    `用户目标：${goal}`,
    `计划天数：${days} 天`,
    `用户习惯画像：${userTypeHint(userType)}`,
    '',
    '问题必须覆盖以下五个维度（每个维度最多 1–2 问，总问题数 3–5）：',
    '1) 量化目标：完成到什么程度算达成（数字/产出物）；',
    '2) 现有基础：目前已经会什么、做到哪一步；',
    '3) 资源约束：每天能投入多久、有哪些设备/材料/预算限制；',
    '4) 偏好风格：喜欢看视频/读书/动手实践、喜欢被拆成小步还是大块；',
    '5) 成功标准：怎么验证自己真的完成了。',
    '',
    '硬性要求：',
    '- 每个问题都要给出 "why"：为什么问这个（一句话，帮用户理解意图）；',
    '- kind 只能是 number | text | single | multi；',
    '- single/multi 必须给出 2–5 个 options；',
    '- 问题要具体到该目标，避免"你的目标是什么"这类空话；',
    `- ${JSON_ONLY}`,
    '',
    '输出 JSON 结构：',
    '{"questions":[{"id":"q1","question":"...","why":"...","kind":"single","options":["...","..."],"dimension":"量化目标"}]}',
    'dimension 取值只能是：量化目标 | 现有基础 | 资源约束 | 偏好风格 | 成功标准 | 其他',
  ].join('\n');
}

// ============ 阶段 2：检索关键词 ============

export function buildKeywordPrompt(
  goal: string,
  days: number,
  answers: QAPair[],
  userType: string,
): string {
  const answerLines = answers.map((a) => `- ${a.question} → ${a.answer}`).join('\n') || '（用户未填写）';
  return [
    '你是信息检索专家。请根据用户目标与澄清回答，提炼 3–6 个【搜索引擎可直接使用】的检索关键词。',
    '',
    `用户目标：${goal}`,
    `计划天数：${days} 天`,
    `用户画像：${userTypeHint(userType)}`,
    '澄清回答：',
    answerLines,
    '',
    '硬性要求：',
    '- 每个关键词 2–12 个字，适合直接搜索（例如"Python 入门 教程""Python 列表推导式 练习"）；',
    '- priority：1 = 最关键（最多 2 个），2 = 重要，3 = 补充；',
    '- reason：一句话说明为什么检索它（要指向用户的具体缺口）；',
    '- lang：zh 或 en（中文平台用 zh，官方文档/英文资料用 en）；',
    '- 不要输出链接、书名或课程名（后续由检索层负责找真实资源）；',
    `- ${JSON_ONLY}`,
    '',
    '输出 JSON 结构：',
    '{"keywords":[{"keyword":"...","priority":1,"reason":"...","lang":"zh"}]}',
  ].join('\n');
}

/** 关键词模板兜底（LLM 不可用时） */
export function buildFallbackKeywords(goal: string): SearchKeyword[] {
  const g = goal.trim().slice(0, 20);
  return [
    { keyword: `${g} 入门 教程`, priority: 1, reason: '先建立整体认知与学习路径', lang: 'zh' },
    { keyword: `${g} 系统学习 路线`, priority: 2, reason: '确认阶段性目标与顺序', lang: 'zh' },
    { keyword: `${g} 练习 项目`, priority: 2, reason: '通过动手练习巩固', lang: 'zh' },
    { keyword: `${g} 常见问题 避坑`, priority: 3, reason: '提前规避常见误区', lang: 'zh' },
  ];
}

// ============ 阶段 3：计划生成（含真实资源引用） ============

export function buildPlanWithResourcesPrompt(params: {
  input: PlanGenInput;
  answers: QAPair[];
  profile?: HabitProfile | null;
  dates: string[];
  resources: ResourceItem[];
  minutesPerDay: number;
}): string {
  const { input, answers, profile, dates, resources, minutesPerDay } = params;
  const answerLines = answers.map((a) => `- ${a.question} → ${a.answer}`).join('\n') || '（未填写）';
  const featureLine = profile
    ? `完成率 ${Math.round(profile.features.completionRate * 100)}%，平均任务耗时 ${
        profile.features.avgTaskDurationMinutes ?? '未知'
      } 分钟，高效时段 ${profile.features.peakCompletionHour ?? '未知'} 点前后`
    : '（无历史数据）';

  const resourceLines =
    resources.length > 0
      ? resources
          .map(
            (r) =>
              `- id=${r.id} | [${r.type}] ${r.title} | ${r.url}${
                r.durationMinutes ? ` | ${r.durationMinutes} 分钟` : ''
              }${r.author ? ` | ${r.author}` : ''}`,
          )
          .join('\n')
      : '（本次没有检索到真实资源，请只引用方法论，不要编造任何链接或书名）';

  return [
    '你是严谨的计划设计专家。请基于【用户目标 + 澄清回答 + 习惯画像 + 真实资源列表】生成逐日可执行计划。',
    '',
    `目标：${input.goal}`,
    `计划形态：${input.planType === 'tasks' ? '每日任务清单' : '事件时段表'}`,
    `必须使用的日期（不得新增或删除，共 ${dates.length} 天）：${dates.join(', ')}`,
    `每日投入参考：${minutesPerDay} 分钟`,
    input.preferences?.availability
      ? `可用时段：${input.preferences.availability.start}–${input.preferences.availability.end}`
      : '可用时段：08:00–22:00',
    `用户画像：${userTypeHint(input.userType)}；${featureLine}`,
    '澄清回答：',
    answerLines,
    '',
    '可用真实资源（只能引用这些，id 必须原样使用）：',
    resourceLines,
    '',
    '硬性要求：',
    '1) 只能使用上面列出的日期；每天 2–5 项；',
    '2) 每项必须包含：title（≤30 字，具体可执行）、minutes（10–180 整数）、time（可选 HH:mm，落在可用时段内且不重叠）、',
    '   reason（安排理由：为什么做、为什么放在这个时段，一句话）、methodology（1–3 个方法论标签，如 番茄工作法/费曼技巧/间隔重复/项目驱动）、',
    '   resourceIds（引用的资源 id 数组，可为空数组）；',
    '3) **严禁编造**：不得出现未在上方列出的链接、视频名、书名、课程名；resourceIds 只能用上面列出的 id；',
    '4) 每天 minutes 之和与每日投入偏差不超过 30%；',
    '5) 必须给出整体策略 strategy：methodology（3–5 条方法论）、risks（**至少 2 条**风险提示）、successCriteria（3–5 条可验证的成功标准）；',
    `6) ${JSON_ONLY}`,
    '',
    '输出 JSON 结构：',
    '{"strategy":{"methodology":["..."],"risks":["...","..."],"successCriteria":["..."]},',
    ' "narrative":"2-3 句总体建议",',
    ' "days":[{"date":"YYYY-MM-DD","tasks":[{"title":"...","minutes":30,"time":"09:00","reason":"...","methodology":["..."],"resourceIds":["bilibili:abc"]}]}]}',
  ].join('\n');
}

/** 规则兜底时的策略模板（不联网、不使用 LLM） */
export function buildRuleStrategy(category: string, days: number): {
  methodology: string[];
  risks: string[];
  successCriteria: string[];
} {
  const riskByCategory: Record<string, string[]> = {
    学习: ['只输入不输出：看完就忘，务必每天留出练习与自测时间', '贪多求快：一次塞太多新内容会挤掉复习时间', '缺少反馈：遇到卡点要及时提问或查资料，不要硬扛'],
    健身: ['突然加量：容易受伤或酸痛过度，注意循序渐进', '忽略热身与拉伸：训练前后各留 5–10 分钟', '作息与饮食不配套：恢复不足时训练效果会打折'],
    工作: ['范围蔓延：先把核心目标做出来，再谈优化', '只做不沟通：关键节点及时同步，避免方向偏差', '忽略收尾：每天留 10 分钟记录进展与阻塞'],
    创作: ['完美主义卡壳：先完成初稿，再迭代打磨', '缺少素材积累：建立随手收集灵感的习惯', '闭门造车：定期拿给他人看，收集真实反馈'],
    通用: ['计划过满：留出缓冲时间，避免连续失败打击信心', '缺少记录：不记录就看不到进展，容易放弃', '一次想改太多习惯：聚焦 1–2 个关键行为'],
  };
  const risks = riskByCategory[category] ?? riskByCategory.通用;
  return {
    methodology: ['目标拆解（把大目标拆成每天可完成的小步）', '间隔重复（每天先复习昨日内容）', '刻意练习（针对薄弱点做小步练习）', '复盘迭代（每天/每周记录并调整）'],
    risks: risks.slice(0, 3),
    successCriteria: [
      `连续 ${days} 天每天至少完成 1 项计划任务`,
      '每 3 天能用自己的话复述/演示已学内容的要点',
      '第 7 天与第 1 天相比，完成同一类任务所需时间明显缩短',
      '结束时能产出一个可展示的成果（笔记 / 作品 / 记录 / 数据）',
    ],
  };
}

/** SearXNG 未配置时的提示（供 UI 与文档复用） */
export const SEARXNG_SETUP_HINT =
  'SearXNG 需在 settings.yml 中开启 json 格式输出：search.formats: [html, json]';

export function describeNetworking(settings: NetworkingSettings): string {
  const on: string[] = [];
  if (settings.bilibili) on.push('B 站搜索 API');
  if (settings.searxng) on.push(`SearXNG(${settings.searxngBaseUrl})`);
  if (settings.jumpLinks) on.push('平台跳转按钮');
  return on.join(' + ') || '（无）';
}
