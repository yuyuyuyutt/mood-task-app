// src/api/browserTaskStore.ts
// 浏览器开发模式（无 Tauri IPC）下的任务存储，落在 localStorage。
//
// 仅用于「在浏览器里预览 / 调试 UI」这一场景：桌面端永远走 Rust + SQLite，
// 本模块不会被触达。字段默认值与 Rust 侧 toCreatePayload 保持一致，
// 这样两种环境渲染出的 Task 形状相同，组件无需分支。
import type { Task } from '../types';
import type { TaskPatch } from './index';
import { STORAGE_PREFIX } from '../utils/storageKeys';

const STORAGE_KEY = `${STORAGE_PREFIX}tasks-browser:v1`;

interface PersistedState {
  version: 1;
  nextId: number;
  tasks: Task[];
}

const EMPTY: PersistedState = { version: 1, nextId: 1, tasks: [] };

function read(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY, tasks: [] };
    const parsed = JSON.parse(raw) as PersistedState;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.tasks)) {
      return { ...EMPTY, tasks: [] };
    }
    return {
      version: 1,
      nextId: typeof parsed.nextId === 'number' ? parsed.nextId : parsed.tasks.length + 1,
      tasks: parsed.tasks,
    };
  } catch {
    return { ...EMPTY, tasks: [] };
  }
}

function write(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 配额满等极端情况忽略，不影响本次会话的内存态表现
  }
}

function toTask(id: number, input: Omit<Task, 'id' | 'created_at'>): Task {
  return {
    id,
    created_at: new Date().toISOString(),
    title: input.title,
    description: input.description,
    status: input.status ?? 'pending',
    priority: input.priority ?? 2,
    energy_cost: input.energy_cost,
    estimated_time: input.estimated_time,
    actual_time: input.actual_time,
    due_date: input.due_date,
    completed_at: input.completed_at,
    tags: input.tags ?? [],
    is_habit: input.is_habit ?? false,
    habit_period: input.habit_period ?? 'daily',
    habit_completions: input.habit_completions ?? [],
    habit_start_date: input.habit_start_date ?? '',
    habit_end_date: input.habit_end_date ?? '',
  };
}

export const browserTaskStore = {
  list(): Task[] {
    return read().tasks;
  },

  create(input: Omit<Task, 'id' | 'created_at'>): number {
    const state = read();
    const id = state.nextId;
    state.tasks.push(toTask(id, input));
    state.nextId = id + 1;
    write(state);
    return id;
  },

  /** 与 patch_task 一致：只覆盖显式传入的字段，值为 null 表示清空该字段 */
  patch(id: number, patch: TaskPatch): Task {
    const state = read();
    const index = state.tasks.findIndex((t) => t.id === id);
    if (index < 0) throw new Error(`任务 #${id} 不存在`);

    const next = { ...state.tasks[index], ...patch } as Task & Record<string, unknown>;
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete next[key];
    }

    state.tasks[index] = next as Task;
    write(state);
    return next as Task;
  },

  remove(id: number): void {
    const state = read();
    state.tasks = state.tasks.filter((t) => t.id !== id);
    write(state);
  },
};
