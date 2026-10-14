// src/features/study/components/StudyReviewCard.tsx
// 复习安排：把"学过就忘"变成一个可执行的排期（1 / 3 / 7 / 16 天）。
//
// 为什么用固定间隔而不是完整 SM-2：这里的输入只有"这条内容学完了"，
// 没有每次复习后的自评质量。用不起的数据不假装用（见 review.ts 的说明）。
//
// 写入纪律：复习任务走既有 `api.createTask`，且**不打计划标签** ——
// 否则会被任务栏的"计划逐条解锁"当成计划条目隐藏起来。
import React from 'react';
import { FaCalendarCheck, FaSpinner, FaInfoCircle } from 'react-icons/fa';
import { REVIEW_INTERVALS_DAYS, buildReviewPlan } from '../review';

export interface StudyReviewCardProps {
  goal?: string;
  taskTitle?: string;
  taskMinutes?: number;
  busy: boolean;
  /** 已经为这条内容排过几条复习 */
  createdCount: number;
  onCreate: () => void;
}

export const StudyReviewCard: React.FC<StudyReviewCardProps> = ({
  goal,
  taskTitle,
  taskMinutes,
  busy,
  createdCount,
  onCreate,
}) => {
  const plan = taskTitle && goal ? buildReviewPlan({ goal, taskTitle, minutes: taskMinutes }) : null;

  return (
    <div className="card p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        <FaCalendarCheck className="text-[11px] text-ink-3" />
        复习安排
      </h3>

      {!plan ? (
        <p className="mt-1.5 text-[11px] text-ink-3">先选一条任务，才能把它的内容排进复习。</p>
      ) : (
        <>
          <p className="mt-1.5 text-[11px] leading-5 text-ink-3">
            按 {REVIEW_INTERVALS_DAYS.join(' / ')} 天四档复习「{taskTitle}」，每次{' '}
            {plan.items[0].minutes} 分钟。
          </p>
          <ul className="mt-2 space-y-1">
            {plan.items.map((item) => (
              <li key={item.dueDate} className="tnum flex items-center justify-between text-[11px] text-ink-2">
                <span>第 {item.round} 次</span>
                <span className="text-ink-3">{item.dueDate}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={onCreate}
            disabled={busy}
            className="btn btn-primary btn-sm mt-3 w-full disabled:opacity-60"
          >
            {busy ? <FaSpinner className="animate-spin text-[10px]" /> : <FaCalendarCheck className="text-[10px]" />}
            创建 4 条复习任务
          </button>
          {createdCount > 0 && (
            <p className="mt-1.5 text-[10px] text-ink-3">已创建 {createdCount} 条复习任务（在任务列表里可见）。</p>
          )}
          <p className="mt-2 flex items-start gap-1 text-[10px] leading-4 text-ink-3">
            <FaInfoCircle className="mt-0.5 shrink-0 text-[9px]" />
            复习任务写入任务表，带「复习」标签，不会被计划的逐条解锁隐藏。
          </p>
        </>
      )}
    </div>
  );
};
