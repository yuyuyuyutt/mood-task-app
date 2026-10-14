// src/features/study/components/PomodoroCard.tsx
// 侧栏计时器：把"专注了多久"变成可见的事实（也是学习会话分钟数的唯一来源）。
//
// 设计取舍：专注结束**不自动开始休息**（见 pomodoro.ts），所以这里的状态永远是可预期的：
// 要么在跑，要么停下来等你决定 —— 不会出现"以为没在计时其实在计"的情况。
import React from 'react';
import { FaPause, FaPlay, FaRedo, FaStepForward, FaClock } from 'react-icons/fa';

export interface PomodoroCardProps {
  clock: string;
  phase: 'focus' | 'break';
  running: boolean;
  focusRounds: number;
  focusedMinutes: number;
  todayMinutes: number;
  focusMinutes: number;
  breakMinutes: number;
  onChangeDurations: (focusMinutes: number, breakMinutes: number) => void;
  onToggle: () => void;
  onSkip: () => void;
  onReset: () => void;
}

const DURATION_PRESETS: Array<{ focus: number; break: number; label: string }> = [
  { focus: 25, break: 5, label: '25 / 5' },
  { focus: 45, break: 10, label: '45 / 10' },
  { focus: 15, break: 3, label: '15 / 3' },
];

export const PomodoroCard: React.FC<PomodoroCardProps> = ({
  clock,
  phase,
  running,
  focusRounds,
  focusedMinutes,
  todayMinutes,
  focusMinutes,
  breakMinutes,
  onChangeDurations,
  onToggle,
  onSkip,
  onReset,
}) => (
  <div className="card p-4">
    <div className="flex items-center justify-between">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        <FaClock className="text-[11px] text-ink-3" />
        番茄钟
      </h3>
      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-ink-3">
        {phase === 'focus' ? '专注' : '休息'}
      </span>
    </div>

    <p
      className={`tnum mt-3 text-center text-4xl font-semibold tabular-nums ${
        running ? 'text-ink' : 'text-ink-2'
      }`}
      aria-live="polite"
    >
      {clock}
    </p>

    <div className="mt-3 flex items-center justify-center gap-1.5">
      <button type="button" onClick={onToggle} className="btn btn-primary btn-sm">
        {running ? <FaPause className="text-[10px]" /> : <FaPlay className="text-[10px]" />}
        {running ? '暂停' : '开始'}
      </button>
      <button type="button" onClick={onSkip} title="跳到下一阶段" className="icon-btn">
        <FaStepForward className="text-[11px]" />
      </button>
      <button type="button" onClick={onReset} title="重置计时" className="icon-btn">
        <FaRedo className="text-[11px]" />
      </button>
    </div>

    <div className="mt-3 flex flex-wrap items-center justify-center gap-1">
      {DURATION_PRESETS.map((preset) => (
        <button
          key={preset.label}
          type="button"
          onClick={() => onChangeDurations(preset.focus, preset.break)}
          data-active={focusMinutes === preset.focus && breakMinutes === preset.break}
          className="chip tnum text-[11px]"
        >
          {preset.label}
        </button>
      ))}
    </div>

    <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
      <div>
        <dt className="text-[10px] text-ink-3">本次专注</dt>
        <dd className="tnum text-sm font-medium text-ink">{focusedMinutes} 分</dd>
      </div>
      <div>
        <dt className="text-[10px] text-ink-3">完成轮次</dt>
        <dd className="tnum text-sm font-medium text-ink">{focusRounds}</dd>
      </div>
      <div>
        <dt className="text-[10px] text-ink-3">今天累计</dt>
        <dd className="tnum text-sm font-medium text-ink">{todayMinutes} 分</dd>
      </div>
    </dl>
  </div>
);
