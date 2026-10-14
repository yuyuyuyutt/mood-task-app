// src/features/study/pomodoro.ts
// 番茄钟的**纯状态机**（无 IO、无 React）：计时、暂停、阶段切换、累计专注时长。
//
// 设计取舍（都是"别让用户被计时器牵着走"）：
//   1) 专注结束**不自动开始休息**：只把阶段切到 break 并暂停，等用户点"开始休息"或"收工"——
//      自动计时会让人误以为还在计学习时长；
//   2) 暂停期间不累计专注毫秒（会话分钟数因此是"真的在学"的时间，而不是"页面开着"的时间）；
//   3) 越过零点时**不结转剩余毫秒**：宁可少记一点，也不要让时间账目变得难以理解；
//   4) 状态是**可序列化的普通对象**：想加"刷新后恢复计时"只需把它存到 localStorage
//      （当前版本没做，因为学习时长以会话为单位落库，刷新丢掉的只是"这一轮的剩余时间"）。
export type PomodoroPhase = 'focus' | 'break';

export const DEFAULT_FOCUS_MINUTES = 25;
export const DEFAULT_BREAK_MINUTES = 5;

export interface PomodoroState {
  focusMinutes: number;
  breakMinutes: number;
  phase: PomodoroPhase;
  running: boolean;
  remainingMs: number;
  /** 已完成的专注轮数 */
  focusRounds: number;
  /** 累计专注毫秒（暂停不计入） */
  focusAccumulatedMs: number;
}

export type PomodoroEvent = 'focus-complete' | 'break-complete';

export interface TickResult {
  state: PomodoroState;
  event?: PomodoroEvent;
}

export function createPomodoroState(
  focusMinutes: number = DEFAULT_FOCUS_MINUTES,
  breakMinutes: number = DEFAULT_BREAK_MINUTES,
): PomodoroState {
  const focus = clampMinutes(focusMinutes, DEFAULT_FOCUS_MINUTES);
  const rest = clampMinutes(breakMinutes, DEFAULT_BREAK_MINUTES);
  return {
    focusMinutes: focus,
    breakMinutes: rest,
    phase: 'focus',
    running: false,
    remainingMs: focus * 60_000,
    focusRounds: 0,
    focusAccumulatedMs: 0,
  };
}

function clampMinutes(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(180, Math.max(1, Math.round(value)));
}

/** 累计专注毫秒 -> 整数分钟（不足 1 分钟按 1 分钟记，避免"学了 40 秒"变成 0） */
export function focusMinutesOf(state: PomodoroState): number {
  if (state.focusAccumulatedMs <= 0) return 0;
  return Math.max(1, Math.round(state.focusAccumulatedMs / 60_000));
}

export function clockText(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function start(state: PomodoroState): PomodoroState {
  return state.running ? state : { ...state, running: true };
}

export function pause(state: PomodoroState): PomodoroState {
  return state.running ? { ...state, running: false } : state;
}

export function toggle(state: PomodoroState): PomodoroState {
  return state.running ? pause(state) : start(state);
}

/** 回到初始状态（保留专注轮数与累计时长的选择由调用方决定，这里全部清零） */
export function reset(state: PomodoroState): PomodoroState {
  return createPomodoroState(state.focusMinutes, state.breakMinutes);
}

/** 手动跳到下一阶段（"这节我不想休息" / "休息够了"） */
export function skipPhase(state: PomodoroState): TickResult {
  if (state.phase === 'focus') {
    return {
      state: {
        ...state,
        phase: 'break',
        running: false,
        remainingMs: state.breakMinutes * 60_000,
        focusRounds: state.focusRounds + 1,
      },
      event: 'focus-complete',
    };
  }
  return {
    state: { ...state, phase: 'focus', running: false, remainingMs: state.focusMinutes * 60_000 },
    event: 'break-complete',
  };
}

/**
 * 推进计时器。`deltaMs` 由调用方按真实时间差给出（而不是固定 1000），
 * 这样即使渲染被节流、窗口被挂起，时间账目仍然对得上。
 */
export function tick(state: PomodoroState, deltaMs: number): TickResult {
  if (!state.running || deltaMs <= 0) return { state };

  const next = state.remainingMs - deltaMs;
  if (next > 0) {
    return {
      state: {
        ...state,
        remainingMs: next,
        focusAccumulatedMs:
          state.phase === 'focus' ? state.focusAccumulatedMs + deltaMs : state.focusAccumulatedMs,
      },
    };
  }

  // 越过零点：结束当前阶段（不结转剩余毫秒）
  if (state.phase === 'focus') {
    return {
      state: {
        ...state,
        phase: 'break',
        running: false,
        remainingMs: state.breakMinutes * 60_000,
        focusRounds: state.focusRounds + 1,
        focusAccumulatedMs: state.focusAccumulatedMs + state.remainingMs,
      },
      event: 'focus-complete',
    };
  }
  return {
    state: { ...state, phase: 'focus', running: false, remainingMs: state.focusMinutes * 60_000 },
    event: 'break-complete',
  };
}
