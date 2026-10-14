// src/features/study/__tests__/pomodoro.test.ts
// 番茄钟状态机：计时准确性、暂停语义、阶段切换、"不自动开始休息"这条产品决定。
import { describe, expect, it } from 'vitest';
import {
  clockText,
  createPomodoroState,
  focusMinutesOf,
  pause,
  reset,
  skipPhase,
  start,
  tick,
  toggle,
} from '../pomodoro';

const MINUTE = 60_000;

describe('pomodoro 状态机', () => {
  it('初始状态：聚焦阶段、未运行、满时长', () => {
    const state = createPomodoroState(25, 5);
    expect(state.phase).toBe('focus');
    expect(state.running).toBe(false);
    expect(state.remainingMs).toBe(25 * MINUTE);
    expect(clockText(state.remainingMs)).toBe('25:00');
  });

  it('未运行时 tick 不改变任何东西', () => {
    const state = createPomodoroState();
    expect(tick(state, 5_000).state).toBe(state);
  });

  it('运行中累计专注毫秒（用于会话分钟数）', () => {
    let state = start(createPomodoroState(25, 5));
    state = tick(state, 10_000).state;
    state = tick(state, 20_000).state;
    expect(state.remainingMs).toBe(25 * MINUTE - 30_000);
    expect(focusMinutesOf(state)).toBe(1); // 30 秒也记 1 分钟（不吞掉真实学习时间）
  });

  it('暂停后不再累计（"页面开着"不等于"在学"）', () => {
    let state = start(createPomodoroState(25, 5));
    state = tick(state, 30_000).state;
    const accumulated = state.focusAccumulatedMs;
    state = pause(state);
    state = tick(state, 60_000).state;
    expect(state.focusAccumulatedMs).toBe(accumulated);
    expect(toggle(state).running).toBe(true);
  });

  it('专注归零：切到休息阶段但**不自动开始**，并计一轮', () => {
    let state = start(createPomodoroState(1, 5));
    const result = tick(state, 1 * MINUTE);
    expect(result.event).toBe('focus-complete');
    state = result.state;
    expect(state.phase).toBe('break');
    expect(state.running).toBe(false);
    expect(state.focusRounds).toBe(1);
    expect(state.remainingMs).toBe(5 * MINUTE);
    expect(focusMinutesOf(state)).toBe(1);
  });

  it('休息归零：回到专注阶段（同样不自动开始）', () => {
    const resting = start({ ...createPomodoroState(1, 1), phase: 'break', remainingMs: 1 * MINUTE });
    const result = tick(resting, 1 * MINUTE);
    expect(result.event).toBe('break-complete');
    expect(result.state.phase).toBe('focus');
    expect(result.state.running).toBe(false);
    expect(result.state.remainingMs).toBe(1 * MINUTE);
  });

  it('手动跳过阶段：等价于该阶段自然结束', () => {
    const skipped = skipPhase(createPomodoroState(25, 5));
    expect(skipped.event).toBe('focus-complete');
    expect(skipped.state.phase).toBe('break');
    expect(skipped.state.focusRounds).toBe(1);
  });

  it('reset 回到初始状态；clockText 处理跨分钟与零点', () => {
    const state = { ...start(createPomodoroState()), focusRounds: 3, focusAccumulatedMs: 12 * MINUTE };
    const fresh = reset(state);
    expect(fresh.focusRounds).toBe(0);
    expect(fresh.focusAccumulatedMs).toBe(0);
    expect(fresh.remainingMs).toBe(25 * MINUTE);

    expect(clockText(0)).toBe('00:00');
    expect(clockText(-1000)).toBe('00:00');
    expect(clockText(59_500)).toBe('01:00');
    expect(clockText(61_000)).toBe('01:01');
  });
});
