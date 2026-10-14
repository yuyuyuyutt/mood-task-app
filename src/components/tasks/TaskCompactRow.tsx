// src/components/tasks/TaskCompactRow.tsx
// 单条任务行。设计要点：
// - 标题是第一视觉层（15px / 中等字重），元信息降为第二层（11px / 弱化色）；
// - 完成按钮只在 hover 时"预告"完成态（描边变绿），点击后立刻变实心 + 打勾回弹，
//   反馈发生在按下的一瞬间，不等任何异步操作；
// - 优先级用一个色点表达，比 "P1" 文本更快被扫读，也几乎不占宽度；
// - **状态徽标常驻在行上**（暂缓 / 进行中 / 完成，点击循环切换）：状态属于"一眼要看的东西"，
//   不该埋在编辑表单里；表单里的状态下拉因此被移除，避免两处口径不一致；
// - 详情（描述、来源、AI 模型）不再挤在行内，而是悬浮时由 `TaskHoverCard` 展示 ——
//   行只留"标题 + 状态 + 时长/日期/标签"。
import React from 'react';
import {
  FaClock,
  FaCalendarAlt,
  FaPencilAlt,
  FaTrash,
  FaCheck,
  FaRedo,
  FaPause,
  FaPlay,
  FaRobot,
} from 'react-icons/fa';
import { Task } from '../../types';
import { STATUS_LABEL, aiTagModel, aiTagOf, nextStatus } from './taskDetails';

interface TaskCompactRowProps {
  task: Task;
  /** 宿主正在播放完成动画（用于即时反馈） */
  done?: boolean;
  onComplete: (task: Task) => void;
  onDelete: (id: number) => void;
  onEdit: (task: Task) => void;
  onMarkHabitComplete: (taskId: number, completed: boolean) => void;
  /** 行上点击状态徽标：按 暂缓 → 进行中 → 完成 循环 */
  onStatusChange?: (task: Task, status: Task['status']) => void;
  /** 悬浮 / 键盘聚焦时请求详情卡（由列表统一渲染，避免被容器裁剪） */
  onHoverStart?: (task: Task, anchor: HTMLElement) => void;
  onHoverEnd?: () => void;
}

function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const HABIT_LABEL: Record<string, string> = {
  daily: '每天',
  weekdays: '工作日',
  weekends: '周末',
  custom: '自定义',
};

const PRIORITY_DOT: Record<number, string> = {
  1: 'bg-danger',
  2: 'bg-warn',
  3: 'bg-ink-3/40',
};

/** 状态徽标的配色：暂缓=中性、进行中=品牌色、完成=成功色 */
const STATUS_BADGE: Record<Task['status'], string> = {
  pending: 'border-line bg-surface-2 text-ink-3 hover:text-ink',
  in_progress: 'border-brand/25 bg-brand-soft text-brand-ink',
  completed: 'border-ok/25 bg-ok-soft text-ok',
};

const STATUS_ICON: Record<Task['status'], React.ReactNode> = {
  pending: <FaPause className="text-[8px]" />,
  in_progress: <FaPlay className="text-[8px]" />,
  completed: <FaCheck className="text-[8px]" />,
};

export const TaskCompactRow: React.FC<TaskCompactRowProps> = ({
  task,
  done: doneSignal = false,
  onComplete,
  onDelete,
  onEdit,
  onMarkHabitComplete,
  onStatusChange,
  onHoverStart,
  onHoverEnd,
}) => {
  const isHabit = !!task.is_habit;
  const habitDoneToday = isHabit
    ? (task.habit_completions ?? []).some((c) => c.date === todayStr() && c.status === 'completed')
    : false;
  const done = isHabit ? habitDoneToday || doneSignal : task.status === 'completed' || doneSignal;
  const overdue = !done && !!task.due_date && task.due_date < todayStr() && !isHabit;

  const toggleDone = () => {
    if (isHabit) onMarkHabitComplete(task.id, !habitDoneToday);
    else onComplete(task);
  };

  const aiTag = aiTagOf(task);
  const meta: React.ReactNode[] = [];

  if (isHabit) {
    meta.push(
      <span key="h" className="inline-flex items-center gap-1">
        <FaRedo className="text-[9px]" />
        {HABIT_LABEL[task.habit_period ?? 'daily'] ?? '习惯'}
      </span>,
    );
  } else {
    if (task.estimated_time != null) {
      meta.push(
        <span key="t" className="tnum inline-flex items-center gap-1">
          <FaClock className="text-[9px]" />
          {task.estimated_time >= 60
            ? `${(task.estimated_time / 60).toFixed(1).replace(/\.0$/, '')}h`
            : `${task.estimated_time}m`}
        </span>,
      );
    }
    if (task.due_date) {
      meta.push(
        <span
          key="d"
          className={`tnum inline-flex items-center gap-1 ${overdue ? 'font-medium text-danger' : ''}`}
        >
          <FaCalendarAlt className="text-[9px]" />
          {task.due_date.slice(5)}
          {overdue && ' 逾期'}
        </span>,
      );
    }
  }

  // 标签只放"内容类"的（目标 / 类别）；AI 生成单独做成徽标，便于一眼识别来源
  const plainTags = (task.tags ?? []).filter((t) => t !== aiTag).slice(0, 2);
  const showStatusBadge = !isHabit && !!onStatusChange;

  return (
    <div
      className={`group relative flex items-center gap-3 px-3 py-2.5 transition-colors duration-150 sm:px-4 ${
        done ? '' : 'hover:bg-surface-2'
      }`}
      onMouseEnter={(e) => onHoverStart?.(task, e.currentTarget)}
      onMouseLeave={() => onHoverEnd?.()}
      onFocusCapture={(e) => onHoverStart?.(task, e.currentTarget)}
      onBlurCapture={() => onHoverEnd?.()}
    >
      {/* 完成按钮 */}
      <button
        type="button"
        onClick={toggleDone}
        aria-pressed={done}
        title={isHabit ? (habitDoneToday ? '取消今日完成' : '标记今日完成') : '完成任务'}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-150 ease-snap active:scale-90 ${
          done
            ? 'check-pop border-ok bg-ok text-white'
            : 'border-line-strong text-transparent hover:border-ok hover:bg-ok/10'
        }`}
      >
        <FaCheck className="text-[8px]" />
      </button>

      {/* 主体 */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {!isHabit && (
            <span
              aria-label={`优先级 ${task.priority}`}
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_DOT[task.priority] ?? 'bg-ink-3/40'}`}
            />
          )}
          <span
            className={`truncate text-[15px] leading-6 ${
              done ? 'text-ink-3 line-through' : 'font-medium text-ink'
            }`}
          >
            {task.title}
          </span>
          {aiTag && (
            <span
              title={aiTagModel(aiTag) ? `由 ${aiTagModel(aiTag)} 生成` : '由 AI 生成'}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] text-brand-ink"
            >
              <FaRobot className="text-[9px]" />
              {aiTag}
            </span>
          )}
        </div>

        <div className="mt-0.5 flex items-center gap-x-2.5 truncate text-[11px] text-ink-3">
          {/* 状态徽标：常驻可见、点击循环切换（暂缓 → 进行中 → 完成） */}
          {showStatusBadge && onStatusChange && (
            <button
              type="button"
              onClick={() => onStatusChange(task, nextStatus(task.status))}
              title={`状态：${STATUS_LABEL[task.status]}（点击切换为「${STATUS_LABEL[nextStatus(task.status)]}」）`}
              className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium transition-all duration-150 ease-snap active:scale-95 ${STATUS_BADGE[task.status]}`}
            >
              {STATUS_ICON[task.status]}
              {STATUS_LABEL[task.status]}
            </button>
          )}
          {meta.map((m, i) => (
            <React.Fragment key={i}>
              {(i > 0 || showStatusBadge) && <span className="text-line-strong">·</span>}
              {m}
            </React.Fragment>
          ))}
          {plainTags.length > 0 && (
            <span className="inline-flex items-center gap-1 truncate">{plainTags.join(' / ')}</span>
          )}
        </div>
      </div>

      {/* 操作：hover 才出现 */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
        <button type="button" onClick={() => onEdit(task)} title="编辑" className="icon-btn">
          <FaPencilAlt className="text-[11px]" />
        </button>
        <button
          type="button"
          onClick={() => onDelete(task.id)}
          title="删除"
          className="icon-btn hover:bg-danger-soft hover:text-danger"
        >
          <FaTrash className="text-[11px]" />
        </button>
      </div>
    </div>
  );
};
