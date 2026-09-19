// src/components/tasks/TaskCompactRow.tsx
// 单条任务行。设计要点：
// - 标题是第一视觉层（15px / 中等字重），元信息降为第二层（11px / 弱化色）；
// - 完成按钮只在 hover 时"预告"完成态（描边变绿），点击后立刻变实心 + 打勾回弹，
//   反馈发生在按下的一瞬间，不等任何异步操作；
// - 优先级用一个色点表达，比 "P1" 文本更快被扫读，也几乎不占宽度。
import React from 'react';
import { FaClock, FaCalendarAlt, FaPencilAlt, FaTrash, FaCheck, FaRedo } from 'react-icons/fa';
import { Task } from '../../types';

interface TaskCompactRowProps {
  task: Task;
  /** 宿主正在播放完成动画（用于即时反馈） */
  done?: boolean;
  onComplete: (task: Task) => void;
  onDelete: (id: number) => void;
  onEdit: (task: Task) => void;
  onMarkHabitComplete: (taskId: number, completed: boolean) => void;
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

export const TaskCompactRow: React.FC<TaskCompactRowProps> = ({
  task,
  done: doneSignal = false,
  onComplete,
  onDelete,
  onEdit,
  onMarkHabitComplete,
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
  if (task.description && !done) {
    meta.unshift(
      <span key="desc" className="max-w-[45%] truncate">
        {task.description}
      </span>,
    );
  }

  const tags = (task.tags ?? []).slice(0, 2);

  return (
    <div
      className={`group relative flex items-center gap-3 px-3 py-2.5 transition-colors duration-150 sm:px-4 ${
        done ? '' : 'hover:bg-surface-2'
      }`}
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
        </div>

        {(meta.length > 0 || tags.length > 0) && (
          <div className="mt-0.5 flex items-center gap-x-2.5 truncate text-[11px] text-ink-3">
            {meta.map((m, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="text-line-strong">·</span>}
                {m}
              </React.Fragment>
            ))}
            {tags.length > 0 && (
              <span className="inline-flex items-center gap-1 truncate">
                {tags.join(' / ')}
              </span>
            )}
          </div>
        )}
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
