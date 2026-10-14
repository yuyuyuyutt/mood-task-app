// src/features/plan-generator/__tests__/agentTrace.test.ts
// run 级轨迹（可观测性）的契约测试。
import { describe, expect, it, vi } from 'vitest';
import { MAX_TRACES, TraceRecorder, TraceStore } from '../services/agent/trace';
import { PROMPT_VERSION } from '../services/prompts';
import type { AgentRunTrace } from '../services/agent/trace';

function trace(id: string): AgentRunTrace {
  return {
    id,
    kind: 'plan',
    level: 'pipeline',
    promptVersion: PROMPT_VERSION,
    startedAt: new Date().toISOString(),
    steps: [],
    fallbacks: [],
    toolCalls: [],
    memoryHits: [],
    warnings: [],
  };
}

describe('TraceRecorder', () => {
  it('记录步骤 / 降级 / 工具 / 记忆，并在 end() 时补齐耗时与版本', async () => {
    const recorder = new TraceRecorder('plan', '学习 Python');
    recorder.setLevel('agent').setModel('qwen2.5:7b').setSchemaApplied(true);

    const value = await recorder.measure('chat:plan', 'llm', async () => 42);
    recorder.fallback('plan', '请求超时');
    recorder.tool('shift_plan_days', true, '待用户确认', { days: 2 });
    recorder.memory(['mem-1', 'mem-2']);
    recorder.warn('已丢弃 2 处无效引用');

    const finished = recorder.end();

    expect(value).toBe(42);
    expect(finished.kind).toBe('plan');
    expect(finished.level).toBe('agent');
    expect(finished.model).toBe('qwen2.5:7b');
    expect(finished.schemaApplied).toBe(true);
    expect(finished.promptVersion).toBe(PROMPT_VERSION);
    expect(finished.steps[0]).toMatchObject({ name: 'chat:plan', kind: 'llm', ok: true });
    expect(finished.fallbacks).toEqual([{ stage: 'plan', reason: '请求超时' }]);
    expect(finished.toolCalls[0]).toMatchObject({ name: 'shift_plan_days', ok: true });
    expect(finished.memoryHits).toEqual(['mem-1', 'mem-2']);
    expect(finished.warnings).toContain('已丢弃 2 处无效引用');
    expect(typeof finished.ms).toBe('number');
    expect(finished.endedAt).toBeTruthy();
  });

  it('measure 失败时记录 ok=false 且不吞异常', async () => {
    const recorder = new TraceRecorder('clarify');
    await expect(
      recorder.measure('chat:clarify', 'llm', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const finished = recorder.end();
    expect(finished.steps[0]).toMatchObject({ name: 'chat:clarify', ok: false, note: 'boom' });
  });

  it('降级原因与备注都会截断，避免 trace 变成日志垃圾场', () => {
    const recorder = new TraceRecorder('keywords');
    recorder.fallback('keywords', 'x'.repeat(400));
    const finished = recorder.end();
    expect(finished.fallbacks[0].reason.length).toBeLessThanOrEqual(161);
  });
});

describe('TraceStore', () => {
  it('环形缓冲只保留最近 capacity 条', () => {
    const store = new TraceStore(3);
    for (const id of ['a', 'b', 'c', 'd']) store.record(trace(id));
    expect(store.list().map((t) => t.id)).toEqual(['d', 'c', 'b']);
    expect(store.latest()?.id).toBe('d');
  });

  it('latest(kind) 按类型取最近一条', () => {
    const store = new TraceStore();
    store.record({ ...trace('m1'), kind: 'plan' });
    store.record({ ...trace('m2'), kind: 'adjust' });
    expect(store.latest('plan')?.id).toBe('m1');
    expect(store.latest('adjust')?.id).toBe('m2');
  });

  it('subscribe 在 record / clear 时被通知，clear 后为空', () => {
    const store = new TraceStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.record(trace('a'));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toHaveLength(1);

    store.clear();
    expect(store.list()).toHaveLength(0);

    unsubscribe();
    store.record(trace('b'));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('默认容量为 MAX_TRACES（与文档保持一致）', () => {
    const store = new TraceStore();
    for (let i = 0; i < MAX_TRACES + 5; i++) store.record(trace(`t${i}`));
    expect(store.list()).toHaveLength(MAX_TRACES);
  });
});
