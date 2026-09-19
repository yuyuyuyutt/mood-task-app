// src/features/plan-generator/services/adapters.ts
// 应用数据 -> 分析器样本 的适配（保持 analyzer 纯净可测）。
import type { Task } from '../../../types';
import type { TaskSample } from '../types';

/** 业务任务转分析样本；类别用首个标签近似（无标签则为未分类） */
export function tasksToSamples(tasks: Task[]): TaskSample[] {
  return tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    createdAt: t.created_at,
    completedAt: t.completed_at,
    estimatedMinutes: t.estimated_time ?? null,
    actualMinutes: t.actual_time ?? null,
    priority: t.priority,
    isHabit: !!t.is_habit,
    tags: t.tags ?? [],
    category: t.tags && t.tags.length > 0 ? t.tags[0] : undefined,
  }));
}
