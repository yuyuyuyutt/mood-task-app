// src/features/study/hooks/usePomodoro.ts
// 番茄钟 hook：把纯状态机接到真实时间上。
//
// 两个实现细节（都会直接影响"时间准不准"）：
//   1) 用 performance.now() 的**真实时间差**推进，而不是每 250ms 固定减 250ms ——
//      后台标签页会被节流，固定步进会让计时器越走越慢；
//   2) 事件（专注结束 / 休息结束）通过回调抛给页面，由页面决定提示方式，
//      hook 本身不弹窗、不发声（组件不该替产品做这种决定）。
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_BREAK_MINUTES,
  DEFAULT_FOCUS_MINUTES,
  clockText,
  createPomodoroState,
  focusMinutesOf,
  pause,
  reset,
  skipPhase,
  start,
  tick,
  toggle,
  type PomodoroEvent,
  type PomodoroState,
} from '../pomodoro';

export interface UsePomodoroOptions {
  focusMinutes?: number;
  breakMinutes?: number;
  onEvent?: (event: PomodoroEvent) => void;
}

export interface UsePomodoroResult {
  state: PomodoroState;
  /** "24:59" */
  clock: string;
  /** 本次累计专注分钟（用于写学习会话） */
  focusedMinutes: number;
  start: () => void;
  pause: () => void;
  toggle: () => void;
  reset: () => void;
  skip: () => void;
  setDurations: (focusMinutes: number, breakMinutes: number) => void;
}

const TICK_MS = 250;

export function usePomodoro(options: UsePomodoroOptions = {}): UsePomodoroResult {
  const [state, setState] = useState<PomodoroState>(() =>
    createPomodoroState(options.focusMinutes ?? DEFAULT_FOCUS_MINUTES, options.breakMinutes ?? DEFAULT_BREAK_MINUTES),
  );

  // 用 ref 镜像最新状态：interval 回调里必须读到"刚更新过的"状态
  const stateRef = useRef(state);
  stateRef.current = state;

  const onEventRef = useRef(options.onEvent);
  onEventRef.current = options.onEvent;

  useEffect(() => {
    if (!state.running) return undefined;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const { state: next, event } = tick(stateRef.current, now - last);
      last = now;
      setState(next);
      if (event) onEventRef.current?.(event);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [state.running]);

  const setDurations = useCallback((focusMinutes: number, breakMinutes: number) => {
    setState((prev) => {
      // 只在"未开始/已暂停的专注阶段"允许改时长，避免把进行中的计时器打乱
      if (prev.running || prev.phase === 'break') return prev;
      return createPomodoroState(focusMinutes, breakMinutes);
    });
  }, []);

  return {
    state,
    clock: clockText(state.remainingMs),
    focusedMinutes: focusMinutesOf(state),
    start: useCallback(() => setState(start), []),
    pause: useCallback(() => setState(pause), []),
    toggle: useCallback(() => setState(toggle), []),
    reset: useCallback(() => setState(reset), []),
    skip: useCallback(() => {
      setState((prev) => {
        const { state: next, event } = skipPhase(prev);
        if (event) onEventRef.current?.(event);
        return next;
      });
    }, []),
    setDurations,
  };
}
