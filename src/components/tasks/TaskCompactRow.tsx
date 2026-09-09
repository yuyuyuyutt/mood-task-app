// src/components/tasks/TaskCompactRow.tsx
// 紧凑型任务行（现代版）：标题直白第一行，描述/元信息第二行单行截断；
// 完成按钮 = 圆框，未完成空心，点击完成后圆框内部变绿并打勾；
// 普通任务完成后由宿主触发"撕便签"离场动画（onComplete）；习惯任务只标记今日。
import React from 'react';
import {
  FaClock,
  FaCalendarAlt,
  FaTag,
  FaPencilAlt,
  FaTrash,
  FaCheck,
  FaHistory,
} from 'react-icons/fa';
import { Task } from '../../types';

interface TaskCompactRowProps {
  task: Task;
  /** 普通任务"完成"（宿主负责播放撕便签动画并移入历史） */
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
  custom: '自定义周期',
};

export const TaskCompactRow: React.FC<TaskCompactRowProps> = ({
  task,
  onComplete,
  onDelete,
  onEdit,
  onMarkHabitComplete,
}) => {
  const isHabit = !!task.is_habit;
  const habitDoneToday = isHabit
    ? (task.habit_completions ?? []).some(
        (c) => c.date === todayStr() && c.status === 'completed',
      )
    : false;
  const done = isHabit ? habitDoneToday : task.status === 'completed';
  const overdue = !done && !!task.due_date && task.due_date < todayStr() && !isHabit;

  const toggleDone = () => {
    if (isHabit) onMarkHabitComplete(task.id, !habitDoneToday);
    else onComplete(task);
  };

  const meta: React.ReactNode[] = [];
  if (isHabit) {
    meta.push(
      <span key="h" className="inline-flex items-center">
        <FaHistory className="w-3 h-3 mr-0.5" />
        {HABIT_LABEL[task.habit_period ?? 'daily'] ?? '习惯'}
      </span>,
    );
  } else {
    meta.push(
      <span key="p" className="font-mono">
        P{task.priority}
      </span>,
    );
    if (task.estimated_time != null) {
      meta.push(
        <span key="t" className="inline-flex items-center">
          <FaClock className="w-3 h-3 mr-0.5" />
          {task.estimated_time >= 60
            ? `${(task.estimated_time / 60).toFixed(1).replace(/\.0$/, '')}h`
            : `${task.estimated_time}m`}
        </span>,
      );
    }
    if (task.due_date) {
      meta.push(
        <span key="d" className={`inline-flex items-center ${overdue ? 'text-red-500 font-medium' : ''}`}>
          <FaCalendarAlt className="w-3 h-3 mr-0.5" />
          {task.due_date.slice(5)}
          {overdue && ' 逾期'}
        </span>,
      );
    }
  }

  const tags = (task.tags ?? []).slice(0, 2);

  return (
    <div
      className={`group relative flex items-center gap-3 px-3 sm:px-4 py-3 transition-colors duration-150 ${
        done ? 'bg-gray-50/80 dark:bg-gray-800/40' : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'
      }`}
    >
      {/* 完成按钮：圆框；完成后内部变绿 + 白勾 */}
      <button
        onClick={toggleDone}
        title={isHabit ? (habitDoneToday ? '取消今日完成' : '标记今日完成') : '完成任务'}
        className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all duration-200 hover:scale-110 active:scale-90 ${
          done
            ? 'bg-green-500 border-green-500 text-white'
            : 'border-gray-300 dark:border-gray-500 text-transparent hover:border-green-500'
        }`}
      >
        <FaCheck className={`w-3 h-3 transition-opacity ${done ? 'opacity-100' : 'opacity-0'}`} />
      </button>

      {/* 主信息：标题第一行（直白），描述/元信息第二行单行截断 */}
      <div className="flex-1 min-w-0">
        <span
          className={`block text-[15px] truncate ${done ? 'line-through text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-gray-100'}`}
        >
          {task.title}
        </span>
        <div className="mt-0.5 flex items-center gap-x-2.5 text-[11px] text-gray-400 dark:text-gray-500 truncate">
          {task.description && !done && (
            <span className="truncate max-w-[40%]">{task.description}</span>
          )}
          {meta.map((m, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="text-gray-200 dark:text-gray-600">·</span>}
              {m}
            </React.Fragment>
          ))}
          {tags.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <FaTag className="w-2.5 h-2.5" />
              {tags.join(' / ')}
            </span>
          )}
        </div>
      </div>

      {/* 操作（hover 显现） */}
      <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <button
          onClick={() => onEdit(task)}
          title="编辑"
          className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <FaPencilAlt className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onDelete(task.id)}
          title="删除"
          className="p-1.5 rounded-md text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
        >
          <FaTrash className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
