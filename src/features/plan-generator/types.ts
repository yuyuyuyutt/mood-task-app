// src/features/plan-generator/types.ts
// 个性化计划生成器的共享类型（纯数据模型，无 IO）。

/** 用户类型（习惯分析推断 + 可手动修正） */
export type UserType =
  | 'morning_person' // 晨型高效
  | 'night_owl' // 夜猫子
  | 'fragmented' // 碎片时间利用者
  | 'long_focus' // 长块专注者
  | 'weekend_worker' // 周末工作者
  | 'regular' // 规律执行者
  | 'balanced'; // 均衡（默认）

export type PlanType = 'tasks' | 'events';

// ---------------- 分析输入 ----------------

/** 分析器使用的任务样本（与业务 Task 解耦，便于单元测试） */
export interface TaskSample {
  id: string | number;
  title: string;
  status: 'pending' | 'in_progress' | 'completed';
  /** 创建时间（ISO） */
  createdAt: string;
  /** 完成时间（ISO） */
  completedAt?: string | null;
  /** 预计分钟数 */
  estimatedMinutes?: number | null;
  /** 实际花费分钟数 */
  actualMinutes?: number | null;
  priority?: number;
  isHabit?: boolean;
  tags?: string[];
  /** 用户自行填写的分类（如 学习/工作/健身） */
  category?: string;
}

/** 分析器使用的事件样本（事件：有明确起止时间的日程块） */
export interface EventSample {
  id: string | number;
  title: string;
  /** 开始时间（ISO） */
  startTime: string;
  /** 结束时间（ISO，可选） */
  endTime?: string;
  category?: string;
}

// ---------------- 分析输出 ----------------

/** 最近 30 天习惯特征（全部由客户端统计得出） */
export interface HabitFeatures {
  /** 窗口内任务总数 */
  totalTasks: number;
  /** 窗口内完成任务数 */
  completedTasks: number;
  /** 完成率 0..1 */
  completionRate: number;
  /** 平均任务耗时（分钟；优先真实耗时，其次预计/实际字段） */
  avgTaskDurationMinutes: number | null;
  durationSamples: number;
  /** 完成时间按小时分布（长度 24） */
  completionHourHistogram: number[];
  /** 事件开始时间按小时分布（长度 24） */
  eventHourHistogram: number[];
  /** 完成任务最集中的小时（无数据为 null） */
  peakCompletionHour: number | null;
  /** 6-10 点完成任务占比 */
  morningRatio: number;
  /** 20-24 点完成任务占比 */
  eveningRatio: number;
  /** 平均事件时长（分钟；无事件为 null） */
  avgEventDurationMinutes: number | null;
  /** 事件覆盖的不同小时数（>4 视为"分布分散"） */
  eventSpreadHours: number;
  /** 完成任务覆盖的不同小时数 */
  taskSpreadHours: number;
  /** 每日主要完成时段的一致性得分：0..1（多数活跃日是否落在同一个小时） */
  consistentTimeScore: number;
  /** 参与一致性统计的活跃完成日数量 */
  consistentTimeDays: number;
  /** 工作日完成任务数 */
  weekdayCompletions: number;
  /** 周末完成任务数 */
  weekendCompletions: number;
  /** 工作日事件数 */
  weekdayEvents: number;
  /** 周末事件数 */
  weekendEvents: number;
  /** 周末/工作日 每日常量强度比（无工作日数据为 null） */
  weekendVsWeekdayRatio: number | null;
  /** 任务类型分布（category 计数） */
  taskTypeDistribution: Record<string, number>;
  /** 窗口内有活动（完成/事件）的天数 */
  activeDays: number;
}

export interface HabitProfile {
  userType: UserType;
  features: HabitFeatures;
  /** 分析时间 */
  analyzedAt: string;
  /** 数据窗口天数 */
  dataWindowDays: number;
  /** 手动修正后的类型（存在时优先于推断值展示） */
  userTypeOverride?: UserType;
}

// ---------------- 计划生成 ----------------

/** 目标类别（模板匹配，仅本地规则） */
export type GoalCategory = '学习' | '健身' | '工作' | '创作' | '通用';

/** 用户可用时间段（HH:mm） */
export interface Availability {
  start: string; // 'HH:mm'
  end: string; // 'HH:mm'
}

/** 生成偏好 */
export interface GenerationPreferences {
  /** 计划风格：跟随画像 / 碎片小任务优先 / 长块专注优先 */
  style?: 'auto' | 'fragmented' | 'long_focus';
  /** 每日可用时段（不填则用画像默认） */
  availability?: Availability;
  /** 每天投入分钟数（不填则按类别默认） */
  minutesPerDay?: number;
  /** 是否允许使用周末 */
  includeWeekend?: boolean;
}

export interface PlanGenInput {
  goal: string;
  days: number;
  planType: PlanType;
  userType: UserType;
  category?: GoalCategory;
  preferences?: GenerationPreferences;
}

export interface PlanTask {
  title: string;
  category: GoalCategory;
  /** 建议耗时（分钟） */
  estimatedMinutes: number;
  /** 建议时段（依据用户类型调整，如 08:00-09:30） */
  bestTime?: string;
  /** 安排理由（为什么这样做、为什么放在这个时段） */
  reason?: string;
  /** 引用的方法论标签，如 费曼技巧 / 番茄工作法 */
  methodology?: string[];
  /** 引用的真实资源 id（对应 GeneratedPlan.resources） */
  resourceIds?: string[];
  /**
   * 引用的**证据片段** id（对应 GeneratedPlan.evidence，形如 `E1`）。
   * 与 resourceIds 同一套纪律：宿主只接受出现在证据清单里的 id，其余一律丢弃并计数。
   */
  evidenceIds?: string[];
}

export interface PlanEvent {
  title: string;
  category: GoalCategory;
  startTime: string; // 'HH:mm'
  endTime: string; // 'HH:mm'
}

export interface PlanDay {
  /** 'YYYY-MM-DD' */
  date: string;
  tasks?: PlanTask[];
  events?: PlanEvent[];
}

export interface GeneratedPlan {
  id: string;
  goal: string;
  planType: PlanType;
  userType: UserType;
  category: GoalCategory;
  createdAt: string;
  /** 生成引擎版本（便于将来重放/升级） */
  engineVersion: 1;
  /** 逐日计划（长度即天数） */
  days: PlanDay[];
  /** 用户拒绝时的反馈（接受为 null） */
  feedback?: string | null;
  accepted: boolean;
  /** AI（本地 Ollama）给出的总体建议文本 */
  aiNarrative?: string | null;
  /** 生成该计划时使用的本地模型名 */
  llmModel?: string | null;
  /** 已写入任务表（数据库）的任务 id */
  materializedTaskIds?: number[];
  /** 写入时间 */
  materializedAt?: string | null;
  /** 整体策略（方法论 / 风险提示 / 成功标准） */
  strategy?: PlanStrategy;
  /** 本次澄清问答（用于回溯与再生成） */
  clarifications?: ClarificationAnswer[];
  /** 计划引用的真实资源（仅标题/URL/元数据，不存正文） */
  resources?: ResourceItem[];
  /** 生成来源与降级说明 */
  generation?: PlanGenerationMeta;
  /** 生成时召回的历史记忆 id（可追溯到具体 MemoryNote） */
  memoryRefs?: string[];
  /**
   * 本次实际注入 prompt 的正文证据片段（截断后的摘要，**不含完整正文**）。
   * 计划里每条 `evidenceIds` 都能在这里追到出处 —— 这是"引用可溯源"的落地形式。
   */
  evidence?: EvidenceRef[];
}

/** 正文证据片段（内容级 RAG 的最小可引用单位） */
export interface EvidenceRef {
  /** 对模型展示的短 id（E1、E2…），不是数据库主键 */
  id: string;
  /** 来源资源 id（对应 GeneratedPlan.resources） */
  resourceId: string;
  /** 该资源内的分块序号（从 0 开始） */
  chunkIndex: number;
  /** 证据摘录（≤ 240 字，够模型判断"讲的是什么"） */
  snippet: string;
  /** 与检索 query 的余弦相似度 */
  score?: number;
  /** 来源页面标题（有则带上，便于 UI 展示） */
  title?: string;
}

// ================= 阶段 1：澄清问题 =================

export type ClarifyQuestionKind = 'number' | 'text' | 'single' | 'multi';

export interface ClarifyingQuestion {
  id: string;
  question: string;
  /** 为什么问这个（UI 展示给用户，帮助理解意图） */
  why: string;
  kind: ClarifyQuestionKind;
  /** single / multi 的候选项 */
  options?: string[];
  placeholder?: string;
  /** 覆盖的维度，便于审计（量化/基础/资源/风格/成功标准） */
  dimension: '量化目标' | '现有基础' | '资源约束' | '偏好风格' | '成功标准' | '其他';
}

export interface ClarifyResult {
  questions: ClarifyingQuestion[];
  /** llm = 模型生成；template = 通用模板兜底 */
  source: 'llm' | 'template';
  /** 降级原因（source=template 时给出） */
  fallbackReason?: string;
  /** 本次使用的提示词版本 */
  promptVersion?: string;
  /** 对应的 run trace id */
  traceId?: string;
}

export interface ClarificationAnswer {
  id: string;
  question: string;
  answer: string;
}

export type ClarifyAnswers = Record<string, string>;

// ================= 阶段 2：资源检索 =================

export interface SearchKeyword {
  keyword: string;
  /** 1 = 最重要 */
  priority: 1 | 2 | 3;
  /** 为什么检索这个词 */
  reason: string;
  /** 建议检索语言 */
  lang?: 'zh' | 'en';
}

export interface KeywordResult {
  keywords: SearchKeyword[];
  source: 'llm' | 'template';
  fallbackReason?: string;
  /** 本次使用的提示词版本 */
  promptVersion?: string;
  /** 对应的 run trace id */
  traceId?: string;
}

export type ResourceSourceId = 'bilibili' | 'searxng' | 'manual' | 'jump';
export type ResourceType = 'video' | 'article' | 'book' | 'post' | 'link';
export type ResourceDifficulty = 'beginner' | 'intermediate' | 'advanced' | 'unknown';
export type ResourceLayer = 1 | 2 | 3;

export interface ResourceItem {
  /** 稳定 id：`${source}:${hash(url|title)}` */
  id: string;
  source: ResourceSourceId;
  layer: ResourceLayer;
  type: ResourceType;
  title: string;
  url: string;
  author?: string;
  /** 视频时长（分钟） */
  durationMinutes?: number;
  /** 发布时间（ISO 或 YYYY-MM-DD） */
  publishedAt?: string;
  metrics?: { views?: number; likes?: number; favorites?: number };
  /** 摘要/描述（仅元数据，不存正文） */
  snippet?: string;
  difficulty?: ResourceDifficulty;
  /** 命中的检索关键词 */
  keyword?: string;
  /** 综合得分 0–1 */
  score?: number;
  scoreDetail?: {
    credibility: number;
    freshness: number;
    difficultyMatch: number;
    preference: number;
    /**
     * 第 5 维：语义相关度（余弦相似度）。
     * 只作为**可解释维度**记录，不参与上面的 4 维加权 ——
     * 余弦是 -1..1 的相似度、其余四维是 0..1 的启发式分，量纲不可比，
     * 硬加权需要反复调参且不可解释；排序统一交给 RRF 融合（见 rag/hybridRetriever.ts）。
     */
    semantic?: number;
  };
}

export interface LayerStatus {
  layer: ResourceLayer;
  enabled: boolean;
  ok: boolean;
  count: number;
  /** 未启用 / 已跳过 / 失败原因 */
  note?: string;
}

export interface JumpLink {
  platform: string;
  label: string;
  url: string;
}

export interface JumpLinkGroup {
  keyword: string;
  links: JumpLink[];
}

export interface ResourceBundle {
  /** 已去重、打分、截断的资源（按得分降序） */
  items: ResourceItem[];
  /** 按类型分组（每类最多 5 条） */
  grouped: Record<ResourceType, ResourceItem[]>;
  /** 按关键词分组（每组最多 3 条） */
  byKeyword: Array<{ keyword: string; items: ResourceItem[] }>;
  /** 第三层：平台跳转按钮（默认启用，无需联网） */
  jumpGroups: JumpLinkGroup[];
  /** 三层状态与降级说明 */
  layers: LayerStatus[];
  warnings: string[];
  /** 语义检索（向量）运行情况：未开启/降级时为 undefined 或 enabled=false */
  semantic?: SemanticSummary;
}

/** 语义检索的一次运行结果摘要（用于 UI 展示与降级说明） */
export interface SemanticSummary {
  enabled: boolean;
  model: string | null;
  /** 本次新写入向量的条数 */
  embedded: number;
  /** 命中内容哈希缓存、直接复用旧向量的条数 */
  reused: number;
  /** 命中语义召回并参与到融合排序的条数 */
  matched: number;
  /** 降级原因（未开启 / 端点不可用 / 维度不匹配等） */
  degradedReason?: string;
}

/** 用户手动维护的资源库条目 */
export interface ManualResource {
  id: string;
  title: string;
  url: string;
  type: ResourceType;
  author?: string;
  difficulty?: ResourceDifficulty;
  /** 适用关键词（便于检索时命中） */
  keywords?: string[];
  note?: string;
  createdAt: string;
}

/**
 * 本地语义检索（向量）设置。
 * 端点沿用「AI 增强」里配置的本地模型地址（Ollama），因此这里不重复配 baseUrl ——
 * 只有"用哪个 embedding 模型"和"开不开"是需要用户决定的。
 */
export interface EmbeddingSettings {
  enabled: boolean;
  /** Ollama embedding 模型，如 nomic-embed-text / bge-m3 */
  model: string;
  /** 单次 embedding 请求超时（毫秒） */
  timeoutMs: number;
  /** 是否抓取资源正文（内容级 RAG；只抓打分最高的少量资源，默认关闭） */
  contentFetch: boolean;
  /** 允许抓取的域名白名单（**留空 = 不允许抓取任何站点**） */
  allowedDomains: string[];
  /** 单次最多抓取几个资源 */
  maxResources: number;
  /** 注入 prompt 的证据片段上限 */
  maxChunks: number;
}

export const DEFAULT_EMBEDDING_SETTINGS: EmbeddingSettings = {
  enabled: false,
  model: 'nomic-embed-text',
  timeoutMs: 15_000,
  contentFetch: false,
  // 默认留空：正文抓取是"会主动访问第三方站点"的动作，必须由用户显式加白名单
  allowedDomains: [],
  maxResources: 3,
  maxChunks: 6,
};

/** 用户可一键加入白名单的常见学习站点（仅作候选，不默认启用） */
export const SUGGESTED_CONTENT_DOMAINS = [
  'bilibili.com',
  'juejin.cn',
  'zhihu.com',
  'douban.com',
  'github.com',
  'developer.mozilla.org',
];

/** 资源与联网设置（默认全部关闭联网，仅跳转按钮） */
export interface NetworkingSettings {
  /** 第一层：B 站搜索 API（默认关闭） */
  bilibili: boolean;
  /** 第二层：本地 SearXNG（默认关闭） */
  searxng: boolean;
  /** SearXNG 地址 */
  searxngBaseUrl: string;
  /** 只搜索这些引擎（空数组 = 不限制） */
  searxngEngines: string[];
  /** 第三层：平台跳转按钮（默认开启，纯链接、不联网） */
  jumpLinks: boolean;
  /** 单次请求超时（毫秒，默认 5000） */
  timeoutMs: number;
  /** 偏好难度（用于难度匹配打分） */
  preferredDifficulty: ResourceDifficulty;
}

export const DEFAULT_NETWORKING_SETTINGS: NetworkingSettings = {
  bilibili: false,
  searxng: false,
  searxngBaseUrl: 'http://localhost:8888',
  searxngEngines: [],
  jumpLinks: true,
  timeoutMs: 5000,
  preferredDifficulty: 'unknown',
};

// ================= 阶段 3：整体策略 =================

export interface PlanStrategy {
  /** 采用的方法论（如 间隔重复 + 项目驱动） */
  methodology: string[];
  /** 风险提示（至少 2 条） */
  risks: string[];
  /** 可验证的成功标准 */
  successCriteria: string[];
}

export interface PlanGenerationMeta {
  /** llm = 模型生成；rule = 规则生成器兜底 */
  source: 'llm' | 'rule';
  model?: string | null;
  /** 降级/安全调整说明 */
  warnings: string[];
  /** 生成时使用的提示词版本（便于效果对比与回滚） */
  promptVersion?: string;
  /** 对应的 run trace id（可在轨迹面板里回看全过程） */
  traceId?: string;
  /** 本次召回的历史记忆条数 */
  memoryUsed?: number;
}

// ================= Memory（三档记忆，本版本落地"情景记忆"） =================

export type MemoryKind = 'episodic' | 'semantic';

/** 结构化记忆条目：结论 + 证据引用 + 置信度，而不是囤积对话原文 */
export interface MemoryNote {
  id: string;
  kind: MemoryKind;
  /** 归一化主题键（同 subjectKey 的记忆会被合并而不是重复堆积） */
  subjectKey: string;
  /** 人类可读主题（如"学习 Python 基础"） */
  subject: string;
  /** 一句话结论 */
  summary: string;
  /** 证据引用（计划 id / 目标 / 时间），任何结论都可追溯 */
  evidence: string[];
  /** 置信度 0..1：命中次数越多越高，长期未命中会衰减 */
  confidence: number;
  /** 被召回次数 */
  hitCount: number;
  createdAt: string;
  lastUsedAt: string;
  /** 来源计划（便于回看原计划） */
  sourcePlanId?: string;
  category?: GoalCategory;
  /** 量化事实（完成率、成败标签等），用于结构化过滤 */
  stats?: {
    accepted?: boolean;
    completionRate?: number;
    plannedDays?: number;
    plannedItems?: number;
    riskHits?: string[];
    /** 学习工作区回流：累计会话数与实际/预估时长（用于校准下次计划的每日投入） */
    studySessions?: number;
    studyMinutes?: number;
    predictedMinutes?: number;
  };
}

/** 召回结果：记忆 + 结构化匹配分（分项可解释） */
export interface MemoryHit {
  note: MemoryNote;
  score: number;
  scoreDetail: {
    category: number;
    lexical: number;
    confidence: number;
    recency: number;
  };
}
