// src/api/__tests__/index.test.ts
// api 层：验证"前端结构 <-> Rust 载荷"的映射、增量更新语义，以及浏览器兜底路径。
//
// 运行环境说明：测试跑在 node 环境（见 vitest.config.ts），而 isTauriRuntime() 看的是
// window.__TAURI_INTERNALS__。因此由测试显式声明处于哪种环境，而不是靠真实全局。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { api } from '../index';

const TASKS_KEY = 'sophotask:tasks-browser:v1';

/** 声明运行在桌面端（Tauri WebView） */
function declareTauriRuntime(): void {
  (globalThis as unknown as { window: unknown }).window = { __TAURI_INTERNALS__: {} };
}

/** 声明运行在浏览器（无 IPC） */
function declareBrowserRuntime(): void {
  delete (globalThis as unknown as { window?: unknown }).window;
}

/** 浏览器兜底依赖 localStorage；node 环境没有，这里注入最小桩 */
function installLocalStorageStub(): void {
  const map = new Map<string, string>();
  const stub = {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: stub,
    configurable: true,
    writable: true,
  });
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: '写周报',
    description: null,
    status: 'pending' as const,
    priority: 2 as const,
    energy_cost: null,
    estimated_time: null,
    actual_time: null,
    due_date: null,
    completed_at: null,
    tags: null,
    created_at: '2026-09-01T08:00:00Z',
    is_habit: null,
    habit_period: null,
    habit_completions: null,
    habit_start_date: null,
    habit_end_date: null,
    ...overrides,
  };
}

beforeEach(() => {
  invoke.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  installLocalStorageStub();
  // 默认按桌面端跑；浏览器分支的用例会自行切到 declareBrowserRuntime()
  declareTauriRuntime();
});

afterEach(() => {
  declareBrowserRuntime();
});

describe('api.getTasks', () => {
  it('把 Rust 行的 JSON 字符串还原为数组，null 还原为 undefined', async () => {
    invoke.mockResolvedValueOnce([
      row({
        tags: '["工作","紧急"]',
        habit_completions: '[{"date":"2026-09-13","completed_at":"2026-09-13T10:00:00Z","status":"completed"}]',
        completed_at: '2026-09-14T12:00:00Z',
        habit_period: 'weekdays',
      }),
    ]);

    const [task] = await api.getTasks();
    expect(task.tags).toEqual(['工作', '紧急']);
    expect(task.habit_completions).toHaveLength(1);
    expect(task.habit_completions?.[0].status).toBe('completed');
    // P0-1：completed_at 必须能透传到前端（此前永远是 undefined）
    expect(task.completed_at).toBe('2026-09-14T12:00:00Z');
    expect(task.description).toBeUndefined();
    expect(task.is_habit).toBe(false);
    expect(task.habit_period).toBe('weekdays');
  });

  it('损坏的 JSON 字段退化为空数组而不是抛错', async () => {
    invoke.mockResolvedValueOnce([row({ tags: '{不是数组' })]);
    const [task] = await api.getTasks();
    expect(task.tags).toEqual([]);
  });

  it('桌面端 IPC 异常时降级为空列表', async () => {
    invoke.mockRejectedValueOnce(new Error('no ipc'));
    await expect(api.getTasks()).resolves.toEqual([]);
  });
});

describe('api.createTask', () => {
  it('补齐默认值，并把数组字段序列化为 JSON 字符串', async () => {
    invoke.mockResolvedValueOnce(row());
    const id = await api.createTask({
      title: '跑步',
      status: 'pending',
      priority: 1,
      tags: ['健康'],
      is_habit: true,
      habit_period: 'daily',
      habit_completions: [],
      completed_at: '2026-09-14T09:00:00Z',
    });

    expect(id).toBe(1);
    const [command, payload] = invoke.mock.calls[0] as [string, { task: Record<string, unknown> }];
    expect(command).toBe('create_task');
    // P0-1：新建任务时 completed_at 也要能写入
    expect(payload.task.completed_at).toBe('2026-09-14T09:00:00Z');
    expect(payload.task.tags).toBe('["健康"]');
    expect(payload.task.habit_completions).toBe('[]');
    expect(payload.task.description).toBeNull();
  });
});

describe('api.updateTask（增量更新）', () => {
  it('只提交显式提供的字段，不再先读全量再整体覆盖', async () => {
    invoke.mockResolvedValueOnce(row({ status: 'completed' }));

    await api.updateTask(7, { status: 'completed', completed_at: '2026-09-14T12:00:00Z' });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('patch_task', {
      id: 7,
      patch: { status: 'completed', completed_at: '2026-09-14T12:00:00Z' },
    });
  });

  it('completed_at: null 会原样传下去（取消完成 = 清空该列）', async () => {
    invoke.mockResolvedValueOnce(row());
    await api.updateTask(7, { status: 'pending', completed_at: null });

    const [, payload] = invoke.mock.calls[0] as [string, { patch: Record<string, unknown> }];
    expect(payload.patch).toEqual({ status: 'pending', completed_at: null });
  });

  it('数组字段序列化后再提交', async () => {
    invoke.mockResolvedValueOnce(row());
    await api.updateTask(3, { tags: ['a'], habit_completions: [] });

    const [, payload] = invoke.mock.calls[0] as [string, { patch: Record<string, unknown> }];
    expect(payload.patch).toEqual({ tags: '["a"]', habit_completions: '[]' });
  });

  it('空 patch 不报错', async () => {
    invoke.mockResolvedValueOnce(row());
    await api.updateTask(3, {});
    expect(invoke).toHaveBeenCalledWith('patch_task', { id: 3, patch: {} });
  });
});

describe('api.deleteTask', () => {
  it('调用 delete_task', async () => {
    invoke.mockResolvedValueOnce(1);
    await api.deleteTask(5);
    expect(invoke).toHaveBeenCalledWith('delete_task', { id: 5 });
  });
});

// ---------------------------------------------------------------------------
// 浏览器兜底：无 IPC 时不得抛错，改由 localStorage 承接增删改
// ---------------------------------------------------------------------------
describe('浏览器环境（无 Tauri IPC）', () => {
  beforeEach(() => {
    declareBrowserRuntime();
  });

  it('getTasks 不触碰 IPC，初始为空数组', async () => {
    await expect(api.getTasks()).resolves.toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('createTask 落盘并补齐默认值，id 自增', async () => {
    const first = await api.createTask({ title: '跑步', status: 'pending', priority: 1 });
    const second = await api.createTask({ title: '读书', status: 'pending', priority: 2 });

    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(invoke).not.toHaveBeenCalled();

    const tasks = await api.getTasks();
    expect(tasks).toHaveLength(2);
    expect(tasks[0].tags).toEqual([]);
    expect(tasks[0].is_habit).toBe(false);
    expect(tasks[0].habit_completions).toEqual([]);
    expect(typeof tasks[0].created_at).toBe('string');
  });

  it('updateTask 只覆盖传入字段', async () => {
    const id = await api.createTask({ title: '跑步', status: 'pending', priority: 1 });
    const updated = await api.updateTask(id, {
      status: 'completed',
      completed_at: '2026-09-14T12:00:00Z',
    });

    expect(updated.status).toBe('completed');
    expect(updated.completed_at).toBe('2026-09-14T12:00:00Z');
    // 未传入的字段保持原值
    expect(updated.title).toBe('跑步');
    expect(updated.priority).toBe(1);
  });

  it('completed_at: null 表示清空字段（取消完成）', async () => {
    const id = await api.createTask({ title: '跑步', status: 'pending', priority: 1 });
    await api.updateTask(id, { status: 'completed', completed_at: '2026-09-14T12:00:00Z' });
    const reverted = await api.updateTask(id, { status: 'pending', completed_at: null });

    expect(reverted.completed_at).toBeUndefined();
    expect('completed_at' in reverted).toBe(false);
  });

  it('deleteTask 后列表不再包含该任务', async () => {
    const id = await api.createTask({ title: '跑步', status: 'pending', priority: 1 });
    await api.deleteTask(id);
    await expect(api.getTasks()).resolves.toEqual([]);
  });

  it('更新不存在的任务会抛错，而不是静默写入', async () => {
    await expect(api.updateTask(999, { status: 'completed' })).rejects.toThrow('任务 #999 不存在');
  });

  it('损坏的存储内容退化为空列表而不是崩溃', async () => {
    localStorage.setItem(TASKS_KEY, '{不是 JSON');
    await expect(api.getTasks()).resolves.toEqual([]);
  });
});
