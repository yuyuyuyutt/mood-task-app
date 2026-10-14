// src/components/tasks/taskDetails.ts
// 任务列表用到的展示层解析（**纯函数**，便于单测）。
//
// 设计原则（与"详情留给内容、元信息走标签"一致）：
//   - 详情里只保留人要看的内容（目标 / 进度 / 建议时段 / 安排理由 / 方法论 / 资源 / 建议）；
//   - 来源类信息（计划生成、AI 生成 · 模型名）从描述里**抽出来变成标签**。
//     新数据由 `planToTaskPayloads` 直接写成标签；老数据里已经写进描述的
//     `来自「…」` / `AI 润色：xxx` 在此处做**显示层迁移**，不改动数据库。
import type { Task } from '../../types';
import { AI_TAG_PREFIX } from '../../features/plan-generator/services/planToTaskPayloads';

/** 旧版写进描述第一行的来源标记（现在由 `计划生成` 标签承担） */
const SOURCE_LINE = '来自「个性化计划生成器」';

/** 描述里可能出现的历史 AI 标记：`AI 润色：qwen2.5:7b` / `AI 生成：qwen2.5:7b` */
const AI_LINE = /^AI\s*(?:润色|生成)\s*[:：]\s*(.+)$/;

export interface ParsedTaskDetails {
  /** 去掉来源类信息后的正文（保留换行与原有顺序） */
  body: string;
  /** 从描述里迁移出来的 AI 标签（形如 `AI 生成 · qwen2.5:7b`） */
  aiTag?: string;
}

export function parseTaskDetails(description?: string): ParsedTaskDetails {
  const text = description ?? '';
  if (!text.trim()) return { body: '' };

  const body: string[] = [];
  let aiTag: string | undefined;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line === SOURCE_LINE) continue;

    const matched = line.match(AI_LINE);
    if (matched) {
      const model = matched[1].trim();
      if (model && !aiTag) aiTag = `${AI_TAG_PREFIX} · ${model}`;
      continue;
    }
    body.push(raw.trimEnd());
  }

  return { body: body.join('\n'), aiTag };
}

/**
 * 任务的 AI 标签：优先取 tags 里已有的（新数据），
 * 否则从描述里迁移（老数据），都没有则说明是规则生成或手工创建。
 */
export function aiTagOf(task: Task): string | undefined {
  const fromTags = (task.tags ?? []).find((t) => t.startsWith(AI_TAG_PREFIX));
  if (fromTags) return fromTags;
  return parseTaskDetails(task.description).aiTag;
}

/** AI 标签里展示的模型名（无模型名时返回空串） */
export function aiTagModel(tag: string): string {
  return tag.startsWith(AI_TAG_PREFIX) ? tag.slice(AI_TAG_PREFIX.length).replace(/^\s*·\s*/, '') : '';
}

/** 截止日期的可读写法：近三天用相对说法（今天 / 明天 / 后天），更远给具体日期 */
export function formatDueDate(date?: string): string | null {
  if (!date) return null;
  const target = new Date(`${date}T00:00:00`);
  if (Number.isNaN(target.getTime())) return date;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '明天';
  if (diffDays === 2) return '后天';
  const md = `${target.getMonth() + 1} 月 ${target.getDate()} 日`;
  return target.getFullYear() === today.getFullYear() ? md : `${target.getFullYear()} 年 ${md}`;
}

// ---------------- 状态：行上点击循环切换 ----------------

/** 循环顺序：暂缓 → 进行中 → 完成 → （回到）暂缓 */
export const TASK_STATUS_ORDER: ReadonlyArray<Task['status']> = ['pending', 'in_progress', 'completed'];

export const STATUS_LABEL: Record<Task['status'], string> = {
  pending: '暂缓',
  in_progress: '进行中',
  completed: '完成',
};

/** 点击状态徽标后的下一个状态 */
export function nextStatus(status: Task['status']): Task['status'] {
  const index = TASK_STATUS_ORDER.indexOf(status);
  return TASK_STATUS_ORDER[(index + 1) % TASK_STATUS_ORDER.length];
}
