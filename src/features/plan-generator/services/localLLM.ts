// src/features/plan-generator/services/localLLM.ts
// 本地 LLM 增强（Ollama）：把规则生成的计划交给本地模型做"润色 + 合理化"。
//
// 隐私与安全约定：
// - 默认【关闭】；只有在设置里显式开启后才会发起请求；
// - 默认端点是本机 http://127.0.0.1:11434（数据不出本机）；
//   若把 baseUrl 改成远端地址，UI 会给出更强的警示；
// - 只发送：目标文本、用户类型、类别、日期列表、每日投入、可用时段，以及规则计划的
//   标题/时长（不含任务内容、心情、头像等其它本地数据）；
// - 模型输出必须是严格 JSON；本模块会逐项校验（日期白名单、时长区间、时间格式），
//   任何不合规内容都会被丢弃或夹紧，最坏情况回退到规则计划。
//
// 关于 CORS：Ollama 默认只允许部分来源。桌面端（tauri://localhost）或自定义端口
// 可能被拒绝，此时请设置环境变量后重启 Ollama：
//   Windows:  setx OLLAMA_ORIGINS "*"
//   macOS/Linux:  OLLAMA_ORIGINS="*" ollama serve
import type { GeneratedPlan, PlanDay, PlanEvent, PlanGenInput, PlanTask } from '../types';

// 传输层（探测 / 生成）已抽到 llmClient.ts，这里保持向后兼容的再导出。
import { DEFAULT_LLM_CONFIG, callOllamaText, isLocalEndpoint } from './llmClient';
import type { LLMConfig as LLMConfigType } from './llmClient';

export {
  DEFAULT_LLM_CONFIG,
  isLocalEndpoint,
  probeOllama,
  type LLMConfig,
  type LLMProviderKind,
  type OllamaProbe,
} from './llmClient';

// ---------------- 提示词 ----------------

const USER_TYPE_HINT: Record<string, string> = {
  morning_person: '晨型高效：重要任务安排在 08:00–10:00',
  night_owl: '夜猫子：重要任务安排在 20:00–22:00',
  fragmented: '碎片时间利用者：拆成 20–30 分钟小块，分散在全天',
  long_focus: '长块专注者：使用 1–2 小时连续时间块',
  weekend_worker: '周末工作者：周末可承担与工作日相当的量',
  regular: '规律执行者：每天固定时段、可适度加量',
  balanced: '均衡型：上下午各安排一段',
};

function minutesBetween(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return 0;
  return Math.max(0, eh * 60 + em - (sh * 60 + sm));
}

/** 构造提示词（导出便于测试/审计：可确认只包含计划相关字段） */
export function buildPlanPrompt(input: PlanGenInput, rulePlan: GeneratedPlan): string {
  const dates = rulePlan.days.map((d) => d.date);
  const perDay = rulePlan.days.map((d) => {
    const minutes =
      (d.tasks ?? []).reduce((s, t) => s + t.estimatedMinutes, 0) ||
      (d.events ?? []).reduce((s, e) => s + minutesBetween(e.startTime, e.endTime), 0);
    return `${d.date}: ${minutes} 分钟`;
  });
  const rough = rulePlan.days.slice(0, 5).map((d) => ({
    date: d.date,
    tasks: (
      d.tasks ??
      d.events?.map((e) => ({ title: e.title, minutes: minutesBetween(e.startTime, e.endTime) })) ??
      []
    ).map((t) => t.title),
  }));

  return [
    '你是一位务实的任务规划助手。请对下面这份"规则生成的计划"做润色与合理化。',
    '',
    `用户画像：${USER_TYPE_HINT[input.userType] ?? input.userType}`,
    `目标：${input.goal}`,
    `目标类别：${rulePlan.category}`,
    `计划形态：${rulePlan.planType === 'tasks' ? '每日任务清单' : '事件时段表'}`,
    `必须使用的日期（不得新增或删除，共 ${dates.length} 天）：${dates.join(', ')}`,
    `每日参考投入：${perDay.join('；')}`,
    input.preferences?.availability
      ? `用户可用时段：${input.preferences.availability.start}–${input.preferences.availability.end}`
      : '用户可用时段：08:00–22:00',
    '',
    '硬性约束：',
    '1) 只能使用上面列出的日期；',
    '2) 每天 2–5 项，每项 title ≤ 30 个汉字，必须具体可执行（可包含数字/章节/动作）；',
    '3) 每项 minutes 为 10–180 的整数；每天 minutes 之和与"每日参考投入"偏差不超过 30%；',
    '4) time 为可选的 24 小时制起始时间（HH:mm），必须落在可用时段内，同一天内不得重叠；',
    '5) 依据用户画像把最重要的任务放在其高效时段；',
    '6) 只输出 JSON，不要任何解释、不要 Markdown 代码块。',
    '',
    '输出 JSON 结构：',
    '{"narrative":"2-3 句中文总体建议（为何这样安排、如何执行）","days":[{"date":"YYYY-MM-DD","tasks":[{"title":"...","minutes":30,"time":"09:00"}]}]}',
    '',
    `规则计划的标题参考（可改写、可拆分、可合并）：${JSON.stringify(rough)}`,
  ].join('\n');
}

// ---------------- 输出解析与合并（纯函数，便于单元测试） ----------------

export interface RawLLMTask {
  title: string;
  minutes: number;
  time?: string;
}

export interface RawLLMDay {
  date: string;
  tasks: RawLLMTask[];
}

export interface RawLLMPlan {
  narrative?: string;
  days: RawLLMDay[];
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 从模型输出中抽取 JSON（容忍代码块围栏与前后杂字） */
export function parseLLMJson(text: string): RawLLMPlan {
  const cleaned = text
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('LLM 输出中未找到 JSON 对象');
  const jsonText = cleaned.slice(start, end + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`LLM 输出的 JSON 无法解析：${err instanceof Error ? err.message : String(err)}`);
  }
  const obj = parsed as Record<string, unknown>;
  const daysRaw = Array.isArray(obj.days) ? obj.days : [];
  const days: RawLLMDay[] = [];
  for (const d of daysRaw) {
    if (!d || typeof d !== 'object') continue;
    const day = d as Record<string, unknown>;
    if (typeof day.date !== 'string') continue;
    const tasksRaw = Array.isArray(day.tasks) ? day.tasks : [];
    const tasks: RawLLMTask[] = [];
    for (const t of tasksRaw) {
      if (!t || typeof t !== 'object') continue;
      const task = t as Record<string, unknown>;
      const title = typeof task.title === 'string' ? task.title.trim() : '';
      if (!title) continue;
      const minutes = Number(task.minutes);
      const time =
        typeof task.time === 'string' && TIME_RE.test(task.time.trim()) ? task.time.trim() : undefined;
      tasks.push({
        title: title.slice(0, 60),
        minutes: Number.isFinite(minutes) ? minutes : 30,
        time,
      });
    }
    if (tasks.length > 0) days.push({ date: day.date, tasks });
  }
  if (days.length === 0) throw new Error('LLM 输出中没有可用的日程');
  return {
    narrative: typeof obj.narrative === 'string' ? obj.narrative.trim().slice(0, 800) : undefined,
    days,
  };
}

export interface MergeResult {
  plan: GeneratedPlan;
  adjustments: string[];
  /** 模型实际覆盖到的天数 */
  usedDays: number;
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 8 * 60;
}

function toHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function clampMinutes(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return 30;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

/**
 * 把 LLM 输出合并回规则计划：
 * - 日期以规则计划为白名单（模型编造的日期直接丢弃）；
 * - 时长夹紧到 10–180 分钟、标题夹紧长度；
 * - time 缺失时沿用规则计划的最佳时段（tasks）或按可用时段依次排布（events）。
 */
export function mergeLLMPlan(
  rulePlan: GeneratedPlan,
  raw: RawLLMPlan,
  availability: { start: string; end: string } = { start: '08:00', end: '22:00' },
): MergeResult {
  const adjustments: string[] = [];
  const knownDates = new Set(rulePlan.days.map((d) => d.date));
  const byDate = new Map(raw.days.map((d) => [d.date, d]));
  const dropped = raw.days.filter((d) => !knownDates.has(d.date)).map((d) => d.date);
  if (dropped.length > 0) {
    adjustments.push(`丢弃了 ${dropped.length} 个计划外日期（${dropped.slice(0, 3).join('、')}…）`);
  }

  const aStart = toMin(availability.start);
  const aEnd = toMin(availability.end);
  let clamped = 0;

  const days: PlanDay[] = rulePlan.days.map((ruleDay) => {
    const llmDay = byDate.get(ruleDay.date);
    if (!llmDay || llmDay.tasks.length === 0) {
      return ruleDay; // 模型漏了这天：保留规则结果
    }
    const items = llmDay.tasks.slice(0, 5);

    if (rulePlan.planType === 'tasks') {
      const tasks: PlanTask[] = items.map((t, i) => {
        const minutes = clampMinutes(t.minutes, 10, 180);
        if (minutes !== t.minutes) clamped++;
        const fallback = ruleDay.tasks?.[i]?.bestTime ?? ruleDay.tasks?.[0]?.bestTime;
        const bestTime = t.time
          ? `${t.time}-${toHHMM(Math.min(toMin(t.time) + minutes, aEnd))}`
          : fallback;
        return { title: t.title, category: rulePlan.category, estimatedMinutes: minutes, bestTime };
      });
      return { date: ruleDay.date, tasks };
    }

    // events：按 time 排布；缺失则从可用时段起点顺序铺开（间隔 10 分钟）
    const events: PlanEvent[] = [];
    let cursor = aStart;
    for (const t of items) {
      const minutes = clampMinutes(t.minutes, 10, 180);
      if (minutes !== t.minutes) clamped++;
      let start = t.time ? toMin(t.time) : cursor;
      if (start < aStart || start >= aEnd) start = cursor;
      const end = Math.min(start + minutes, aEnd);
      if (end - start < 10) break; // 超出可用时段，放弃剩余项
      events.push({
        title: t.title,
        category: rulePlan.category,
        startTime: toHHMM(start),
        endTime: toHHMM(end),
      });
      cursor = end + 10;
    }
    return events.length > 0 ? { date: ruleDay.date, events } : ruleDay;
  });

  if (clamped > 0) adjustments.push(`夹紧了 ${clamped} 项超出 10–180 分钟的时长`);

  return {
    plan: { ...rulePlan, days, aiNarrative: raw.narrative ?? null },
    adjustments,
    usedDays: days.filter((d) => byDate.has(d.date)).length,
  };
}

// ---------------- 对外接口 ----------------

export interface LLMPlanRequest {
  input: PlanGenInput;
  rulePlan: GeneratedPlan;
  habitSummary?: string;
}

export interface LLMPlanResponse {
  plan: GeneratedPlan;
  /** 模型给出的总体建议文本 */
  narrative: string | null;
  /** 本次合并中做过的安全调整 */
  adjustments: string[];
  model: string;
}

/**
 * 用本地 Ollama 润色/合理化计划（**旧版单步接口**）。
 *
 * 注意：三阶段向导（澄清 → 资源 → 计划）走的是
 * `prompts.buildPlanWithResourcesPrompt` + `planComposer.composePlan`；
 * 本函数保留用于"单步生成"兼容场景与既有测试，提示词仍在 prompts.ts 集中管理。
 */
export async function generatePlanWithLLM(
  req: LLMPlanRequest,
  config: LLMConfigType = DEFAULT_LLM_CONFIG,
): Promise<LLMPlanResponse> {
  if (!config.enabled) {
    throw new Error('LLM 增强未启用（默认关闭）。本功能默认全部在本地完成。');
  }
  if (config.provider !== 'ollama') {
    throw new Error(`提供商 "${config.provider}" 尚未实现，请使用本地 Ollama。`);
  }
  if (!config.model) {
    throw new Error('尚未选择模型：请先点击"检测本地 Ollama"并选择一个模型。');
  }
  if (!isLocalEndpoint(config.baseUrl)) {
    console.warn('[plan-generator] LLM 端点非本机，数据将离开本机：', config.baseUrl);
  }

  const prompt = buildPlanPrompt(req.input, req.rulePlan);
  const text = await callOllamaText(prompt, config);
  const raw = parseLLMJson(text);
  const availability = req.input.preferences?.availability ?? { start: '08:00', end: '22:00' };
  const { plan, adjustments } = mergeLLMPlan(req.rulePlan, raw, availability);

  return {
    plan: { ...plan, llmModel: config.model },
    narrative: plan.aiNarrative ?? null,
    adjustments,
    model: config.model,
  };
}
