// src/features/plan-generator/__tests__/llmTaskManager.test.ts
// LLM 生命周期管理器测试：串行执行（避免 CPU 峰值）、同 key 去重、取消。
import { describe, expect, it } from 'vitest';
import { LlmTaskManager } from '../services/llmTaskManager';

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

describe('LlmTaskManager', () => {
  it('串行执行：任意时刻只有一个任务在跑', async () => {
    const manager = new LlmTaskManager(1);
    let concurrent = 0;
    let maxConcurrent = 0;

    const task = (key: string) =>
      manager.run({
        kind: 'plan',
        key,
        run: async () => {
          concurrent += 1;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await tick(10);
          concurrent -= 1;
          return key;
        },
      });

    const results = await Promise.all([task('a'), task('b'), task('c')]);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(maxConcurrent).toBe(1);
    expect(manager.getStats().completed).toBe(3);
  });

  it('同 key 去重：新任务取消尚未完成的旧任务', async () => {
    const manager = new LlmTaskManager(1);
    const first = manager.run({
      kind: 'clarify',
      key: 'clarify',
      run: async () => {
        await tick(30);
        return 'old';
      },
    });

    // 让第一个任务真正开始（经过 whenIdle 的 setTimeout 0）
    await tick(10);

    const second = manager.run({
      kind: 'clarify',
      key: 'clarify',
      run: async () => 'new',
    });

    await expect(first).rejects.toThrow(/取消|取消/);
    await expect(second).resolves.toBe('new');
    expect(manager.getStats().cancelled).toBeGreaterThanOrEqual(1);
  });

  it('cancelAll 取消在途与排队的任务', async () => {
    const manager = new LlmTaskManager(1);
    const p1 = manager.run({
      kind: 'keywords',
      key: 'k1',
      run: async () => {
        await tick(50);
        return 1;
      },
    });
    const p2 = manager.run({ kind: 'plan', key: 'k2', run: async () => 2 });
    await tick(10);
    manager.cancelAll();
    await expect(p1).rejects.toThrow(/取消/);
    await expect(p2).rejects.toThrow(/取消/);
  });

  it('任务超时会中止（不会永久挂着占用资源）', async () => {
    const manager = new LlmTaskManager(1);
    const p = manager.run({
      kind: 'plan',
      key: 'slow',
      timeoutMs: 40,
      run: (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    });
    await expect(p).rejects.toThrow(/取消|超时/);
  });

  it('失败计入 failed 统计并原样抛出', async () => {
    const manager = new LlmTaskManager(1);
    await expect(
      manager.run({ kind: 'plan', key: 'bad', run: async () => { throw new Error('boom'); } }),
    ).rejects.toThrow('boom');
    expect(manager.getStats().failed).toBe(1);
  });
});
