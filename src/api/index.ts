// src/api/index.ts
// 与 Rust 侧 SQLite 交互的**唯一**入口。
//
// 数据归属约定（重要）：
// - 任务数据 -> SQLite `tasks` 表（本文件）；
// - 心情数据 -> 插件命名空间 `plugin_data(namespace='mood', collection='entries')`，
//   见 plugins/pages/moodData.ts；SQLite 的 `moods` 表已废弃，仅保留一次性迁移源。
//
// 运行环境：桌面端走 Tauri IPC；浏览器开发模式没有 IPC，改由 browserTaskStore
// （localStorage）承接，使 UI 在浏览器里也能完整走通增删改。
import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from '../utils/runtime';
import { browserTaskStore } from './browserTaskStore';
import type { HabitCompletion, HabitPeriod, Task } from '../types';

/** Rust 侧 Task 行：tags / habit_completions 是 JSON 字符串 */
interface TaskRow {
  id: number;
  title: string;
  description: string | null;
  status: Task['status'];
  priority: 1 | 2 | 3;
  energy_cost: number | null;
  estimated_time: number | null;
  actual_time: number | null;
  due_date: string | null;
  completed_at: string | null;
  tags: string | null;
  created_at: string;
  is_habit: boolean | null;
  habit_period: HabitPeriod | null;
  habit_completions: string | null;
  habit_start_date: string | null;
  habit_end_date: string | null;
}

/** 增量更新载荷；`completed_at: null` 表示清空（取消完成） */
export type TaskPatch = Partial<Omit<Task, 'id' | 'created_at' | 'completed_at'>> & {
  completed_at?: string | null;
};

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status,
    priority: row.priority,
    energy_cost: row.energy_cost ?? undefined,
    estimated_time: row.estimated_time ?? undefined,
    actual_time: row.actual_time ?? undefined,
    due_date: row.due_date ?? undefined,
    completed_at: row.completed_at ?? undefined,
    tags: parseJson<string[]>(row.tags, []),
    created_at: row.created_at,
    is_habit: row.is_habit ?? false,
    habit_period: row.habit_period ?? 'daily',
    habit_completions: parseJson<HabitCompletion[]>(row.habit_completions, []),
    habit_start_date: row.habit_start_date ?? '',
    habit_end_date: row.habit_end_date ?? '',
  };
}

function toCreatePayload(task: Omit<Task, 'id' | 'created_at'>) {
  return {
    title: task.title,
    description: task.description ?? null,
    status: task.status ?? 'pending',
    priority: task.priority ?? 2,
    energy_cost: task.energy_cost ?? null,
    estimated_time: task.estimated_time ?? null,
    actual_time: task.actual_time ?? null,
    due_date: task.due_date ?? null,
    completed_at: task.completed_at ?? null,
    tags: task.tags ? JSON.stringify(task.tags) : null,
    is_habit: task.is_habit ?? false,
    habit_period: task.habit_period ?? null,
    habit_completions: JSON.stringify(task.habit_completions ?? []),
    habit_start_date: task.habit_start_date || null,
    habit_end_date: task.habit_end_date || null,
  };
}

/** 只保留调用方显式提供的字段；数组字段序列化为 JSON 文本 */
function toPatchPayload(patch: TaskPatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    out[key] = key === 'tags' || key === 'habit_completions' ? JSON.stringify(value ?? []) : value;
  }
  return out;
}

export const api = {
  async getTasks(): Promise<Task[]> {
    if (!isTauriRuntime()) return browserTaskStore.list();
    try {
      const rows = (await invoke('get_tasks')) as TaskRow[];
      return rows.map(toTask);
    } catch (error) {
      // 桌面端 IPC 异常时按空列表降级而不是崩溃
      console.warn('读取任务失败，按空列表降级:', error);
      return [];
    }
  },

  async createTask(task: Omit<Task, 'id' | 'created_at'>): Promise<number> {
    if (!isTauriRuntime()) return browserTaskStore.create(task);
    const created = (await invoke('create_task', { task: toCreatePayload(task) })) as TaskRow;
    return created.id;
  },

  /** 增量更新：只提交传入的字段，服务端不再做"读-改-写"，避免覆盖并发修改 */
  async updateTask(id: number, patch: TaskPatch): Promise<Task> {
    if (!isTauriRuntime()) return browserTaskStore.patch(id, patch);
    const row = (await invoke('patch_task', { id, patch: toPatchPayload(patch) })) as TaskRow;
    return toTask(row);
  },

  async deleteTask(id: number): Promise<void> {
    if (!isTauriRuntime()) {
      browserTaskStore.remove(id);
      return;
    }
    await invoke('delete_task', { id });
  },
};
