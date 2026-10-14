// src/features/study/types.ts
// 「学习工作区」的领域类型。
//
// 边界约定（决定了这些数据放哪）：
//   - 会话 / 笔记 / 资源进度 / 辅导记录 = **学习工作区自己的实体**，走 `__study` 命名空间
//     （PluginDataStore：桌面落 SQLite plugin_data，浏览器落 localStorage），
//     因此天然被「数据备份」全量导出与恢复；
//   - 正文全文**不在这里**：它沿用既有的临时缓存（7 天 / 20 页 / 单页 6000 字，不进备份），
//     与既有隐私口径保持一致；
//   - 学习任务仍然写进 `tasks` 表（复用既有写通道），不新建第二套任务系统。
import type { GoalCategory, ResourceItem } from '../plan-generator/types';

/** 一次学习会话（开始 → 结束的全部事实） */
export interface StudySession {
  id: string;
  /** ISO 时间 */
  startedAt: string;
  endedAt: string;
  /** 实际专注分钟（计时器累计，暂停不计入） */
  minutes: number;
  /** 本次会话对应的目标（来自计划） */
  goal: string;
  planId?: string;
  taskId?: number;
  taskTitle?: string;
  resourceId?: string;
  resourceTitle?: string;
  /** 任务预估时长（用于"预测 vs 实际"回流） */
  predictedMinutes?: number;
  /** 收工时的三行总结 */
  summary?: string;
  /** 自评：今天的成功标准是否达成 */
  achieved?: boolean;
  category?: GoalCategory;
}

/** 学习笔记（工作区自己的实体；随备份导出） */
export interface StudyNote {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  body: string;
  tags: string[];
  resourceId?: string;
  resourceTitle?: string;
  taskId?: number;
  sessionId?: string;
}

export type ResourceState = 'unread' | 'reading' | 'done';

/** 资源阅读进度：消灭"这条我看过吗"的重复点开 */
export interface ResourceProgress {
  resourceId: string;
  url: string;
  state: ResourceState;
  openedAt?: string;
  lastReadAt?: string;
  /** 累计阅读分钟（按会话归集） */
  minutesSpent: number;
  readCount: number;
}

export interface TutorMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  /** assistant 消息的引用编号（E1..En），可追溯到具体片段 */
  citations?: string[];
}

/** 辅导对话按资源维度保存（换资源就是换话题，不混在一起） */
export interface TutorThread {
  resourceId: string;
  resourceTitle?: string;
  messages: TutorMessage[];
  updatedAt: string;
}

/** 资源 -> 正文的读取结果（含"为什么读不到"的可解释原因） */
export interface ReadingOutcome {
  status: 'cache' | 'fetched' | 'disabled' | 'blocked' | 'failed';
  url: string;
  domain: string;
  title: string;
  text: string;
  /**
   * 正文的 Markdown 版本（保留原网站的标题层级 / 加粗 / 列表 / 代码块 / 引用）。
   * 阅读模式优先渲染它；没有时（浏览器直连、旧缓存）回退到 `text` 的纯文本段落。
   */
  markdown?: string;
  /** 由服务端截断时给出（提示"只读了前 6000 字"） */
  truncated?: boolean;
  /** 读不到时的原因（直接展示给用户） */
  reason?: string;
}

/** 复习安排（间隔重复：1 / 3 / 7 / 16 天） */
export interface StudyReviewItem {
  /** 'YYYY-MM-DD' */
  dueDate: string;
  title: string;
  minutes: number;
  /** 第几次复习（1 起） */
  round: number;
}

export interface StudyReviewPlan {
  goal: string;
  items: StudyReviewItem[];
}

/** 工作区里的资源（计划资源 + 阅读进度 + 证据片段的组合视图） */
export interface StudyResourceView {
  resource: ResourceItem;
  progress?: ResourceProgress;
  /** 生成计划时抓到的正文摘要（≤240 字/条），永久保留在计划里 */
  snippets: string[];
}
