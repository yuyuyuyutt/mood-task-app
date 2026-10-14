// src/components/tasks/TaskHoverCard.tsx
// 任务行的悬浮详情卡。
//
// 为什么用 createPortal + position: fixed：
//   任务列表外层是 `.card overflow-hidden`，用绝对定位的 tooltip 会被容器裁掉；
//   挂到 body 上并用视口坐标定位，才能保证无论列表多长、滚动到哪里都能完整显示。
//
// 交互细节（决定了它是"好用"还是"烦人"）：
//   - 进入延迟 160ms：鼠标只是划过时不会弹卡；
//   - 离开延迟 140ms：允许鼠标从行移到卡片上（卡片可选中复制、可点链接）；
//   - 滚动/尺寸变化/任务消失时立即关闭（避免卡片"飘"在错位的地方）。
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaClock, FaCalendarAlt, FaRedo, FaRobot } from 'react-icons/fa';
import type { Task } from '../../types';
import { STATUS_LABEL, aiTagOf, formatDueDate, parseTaskDetails } from './taskDetails';
import { PLAN_TAG } from '../../features/plan-generator/services/planToTaskPayloads';

const CARD_WIDTH = 320;
const GAP = 12;
/** 垂直方向的估算高度（用于避免卡片底部超出视口；实际高度由 max-height + 内部滚动兜住） */
const HEIGHT_ESTIMATE = 240;

const PRIORITY_LABEL: Record<number, string> = { 1: '高', 2: '中', 3: '低' };
const PRIORITY_DOT: Record<number, string> = {
  1: 'bg-danger',
  2: 'bg-warn',
  3: 'bg-ink-3/40',
};
const HABIT_LABEL: Record<string, string> = {
  daily: '每天',
  weekdays: '工作日',
  weekends: '周末',
  custom: '自定义',
};

const STATUS_BADGE: Record<Task['status'], string> = {
  pending: 'border-line bg-surface-2 text-ink-3',
  in_progress: 'border-brand/25 bg-brand-soft text-brand-ink',
  completed: 'border-ok/25 bg-ok-soft text-ok',
};

function formatMinutes(minutes?: number): string | null {
  if (minutes == null) return null;
  return minutes >= 60 ? `${(minutes / 60).toFixed(1).replace(/\.0$/, '')} 小时` : `${minutes} 分钟`;
}

// ---------------- 悬浮状态管理 ----------------

interface HoverTarget {
  id: number;
  rect: DOMRect;
}

export interface UseTaskHoverCardResult {
  /** 当前应该展示的详情（任务对象始终取最新的那份） */
  hovered: { task: Task; rect: DOMRect } | null;
  onRowEnter: (task: Task, anchor: HTMLElement) => void;
  onRowLeave: () => void;
  onCardEnter: () => void;
  onCardLeave: () => void;
  close: () => void;
}

const OPEN_DELAY = 160;
const CLOSE_DELAY = 140;

/**
 * 悬浮详情卡的状态机。放在列表层统一管理（而不是每行各管一个），
 * 好处是同一时刻最多只有一张卡，且行被卸载/列表重排时不会留下孤儿节点。
 */
export function useTaskHoverCard(tasks: Task[]): UseTaskHoverCardResult {
  const [target, setTarget] = useState<HoverTarget | null>(null);
  const timer = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const close = useCallback(() => {
    clearTimer();
    setTarget(null);
  }, [clearTimer]);

  const onRowEnter = useCallback(
    (task: Task, anchor: HTMLElement) => {
      clearTimer();
      timer.current = window.setTimeout(() => {
        setTarget({ id: task.id, rect: anchor.getBoundingClientRect() });
      }, OPEN_DELAY);
    },
    [clearTimer],
  );

  const onRowLeave = useCallback(() => {
    clearTimer();
    timer.current = window.setTimeout(() => setTarget(null), CLOSE_DELAY);
  }, [clearTimer]);

  const onCardEnter = useCallback(() => clearTimer(), [clearTimer]);

  const onCardLeave = useCallback(() => {
    clearTimer();
    setTarget(null);
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  // 任务从列表里消失（完成 / 删除）时立刻收起，避免卡片指着不存在的行
  useEffect(() => {
    if (target && !tasks.some((t) => t.id === target.id)) setTarget(null);
  }, [tasks, target]);

  // 滚动或窗口尺寸变化后，缓存的行坐标就失效了 —— 直接关闭比"飘着"更不容易误导
  useEffect(() => {
    if (!target) return undefined;
    const onChange = () => setTarget(null);
    window.addEventListener('scroll', onChange, true);
    window.addEventListener('resize', onChange);
    return () => {
      window.removeEventListener('scroll', onChange, true);
      window.removeEventListener('resize', onChange);
    };
  }, [target]);

  const task = target ? tasks.find((t) => t.id === target.id) : undefined;
  return {
    hovered: task && target ? { task, rect: target.rect } : null,
    onRowEnter,
    onRowLeave,
    onCardEnter,
    onCardLeave,
    close,
  };
}

// ---------------- 卡片本体 ----------------

export interface TaskHoverCardProps {
  task: Task;
  anchor: DOMRect;
  onCardEnter: () => void;
  onCardLeave: () => void;
}

export const TaskHoverCard: React.FC<TaskHoverCardProps> = ({
  task,
  anchor,
  onCardEnter,
  onCardLeave,
}) => {
  const details = parseTaskDetails(task.description);
  const aiTag = aiTagOf(task);

  // 优先显示在行的右侧；右侧放不下就翻到左侧
  const left =
    anchor.right + GAP + CARD_WIDTH <= window.innerWidth - 8
      ? anchor.right + GAP
      : Math.max(8, anchor.left - CARD_WIDTH - GAP);
  const top = Math.max(
    8,
    Math.min(anchor.top, window.innerHeight - HEIGHT_ESTIMATE - 8),
  );

  const minutes = formatMinutes(task.estimated_time);
  const due = formatDueDate(task.due_date);
  const overdue = !!task.due_date && task.due_date < new Date().toISOString().slice(0, 10);
  const tags = task.tags ?? [];

  return createPortal(
    <div
      role="tooltip"
      onMouseEnter={onCardEnter}
      onMouseLeave={onCardLeave}
      style={{ left, top, width: CARD_WIDTH }}
      className="panel-in fixed z-50 max-h-[60vh] overflow-y-auto rounded-xl border border-line bg-surface p-3.5 shadow-2"
    >
      <div className="flex items-start gap-2">
        {!task.is_habit && (
          <span
            aria-hidden
            className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_DOT[task.priority] ?? 'bg-ink-3/40'}`}
          />
        )}
        <p
          className={`min-w-0 flex-1 text-[13px] leading-5 font-medium ${
            task.status === 'completed' ? 'text-ink-3 line-through' : 'text-ink'
          }`}
        >
          {task.title}
        </p>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_BADGE[task.status]}`}
        >
          {STATUS_LABEL[task.status]}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-3">
        {!task.is_habit && <span>优先级 {PRIORITY_LABEL[task.priority] ?? '中'}</span>}
        {minutes && (
          <span className="tnum inline-flex items-center gap-1">
            <FaClock className="text-[9px]" />
            {minutes}
          </span>
        )}
        {due && (
          <span
            className={`tnum inline-flex items-center gap-1 ${overdue && task.status !== 'completed' ? 'font-medium text-danger' : ''}`}
          >
            <FaCalendarAlt className="text-[9px]" />
            {due}
            {overdue && task.status !== 'completed' && '· 已逾期'}
          </span>
        )}
        {task.is_habit && (
          <span className="inline-flex items-center gap-1">
            <FaRedo className="text-[9px]" />
            习惯 · {HABIT_LABEL[task.habit_period ?? 'daily'] ?? '自定义'}
          </span>
        )}
      </div>

      {details.body && (
        <div className="mt-2.5 border-t border-line pt-2.5 text-[12px] leading-5 whitespace-pre-wrap text-ink-2">
          {details.body}
        </div>
      )}

      {tags.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {tags.map((tag) => (
            <span
              key={tag}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${
                tag.startsWith('AI 生成')
                  ? 'bg-brand-soft text-brand-ink'
                  : tag === PLAN_TAG
                    ? 'bg-surface-3 text-ink-2'
                    : 'bg-surface-2 text-ink-3'
              }`}
            >
              {tag.startsWith('AI 生成') && <FaRobot className="text-[9px]" />}
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* 老数据：AI 标记还写在描述里，这里以标签形式补出来（不改数据库） */}
      {aiTag && !tags.includes(aiTag) && (
        <div className="mt-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[10px] text-brand-ink">
            <FaRobot className="text-[9px]" />
            {aiTag}
          </span>
        </div>
      )}
    </div>,
    document.body,
  );
};
