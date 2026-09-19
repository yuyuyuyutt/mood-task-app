// src/components/tasks/TaskFilter.tsx
// 筛选/排序工具条。设计取舍：
// - 从"大白卡片"压缩成一条工具条，把纵向空间让给任务列表本身（列表才是页面主体）；
// - 一级筛选（全部/今日/未完成/已完成/习惯）常驻为胶囊，二级（优先级/任务类型）收进"更多"，
//   避免 10+ 个同等权重的按钮同时争夺注意力；
// - 排序用原生 select：无额外文案、键盘可达、不占宽度。
import React, { useState } from 'react';
import { FaFilter, FaSort, FaSlidersH, FaStar, FaHistory } from 'react-icons/fa';

interface TaskFilterProps {
  onFilterChange: (filter: string) => void;
  onSortChange: (sort: string) => void;
  onPriorityFilterChange?: (priority: number | null) => void;
  onHabitFilterChange?: (showHabits: boolean | null) => void;
  activeFilter: string;
  activeSort: string;
  activePriority?: number | null;
  activeHabitFilter?: boolean | null;
  totalTasks: number;
  completedTasks: number;
}

const FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'today', label: '今日' },
  { id: 'pending', label: '未完成' },
  { id: 'completed', label: '已完成' },
  { id: 'habits', label: '习惯' },
];

const PRIORITIES = [
  { id: 1, label: '高' },
  { id: 2, label: '中' },
  { id: 3, label: '低' },
];

const SORTS = [
  { id: 'priority_asc', label: '优先级 高→低' },
  { id: 'priority_desc', label: '优先级 低→高' },
  { id: 'due_date', label: '截止日期' },
  { id: 'created', label: '创建时间' },
  { id: 'habit', label: '习惯优先' },
];

export const TaskFilter: React.FC<TaskFilterProps> = ({
  onFilterChange,
  onSortChange,
  onPriorityFilterChange,
  onHabitFilterChange,
  activeFilter,
  activeSort,
  activePriority,
  activeHabitFilter,
  totalTasks,
  completedTasks,
}) => {
  const [showMore, setShowMore] = useState(false);
  const moreActiveCount =
    (activePriority != null ? 1 : 0) + (activeHabitFilter != null ? 1 : 0);

  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return (
    <div className="mb-2.5">
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
        {/* 一级筛选 */}
        <FaFilter className="mr-0.5 shrink-0 text-[10px] text-ink-3" aria-hidden />
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onFilterChange(f.id)}
            data-active={activeFilter === f.id}
            className="chip"
          >
            {f.label}
          </button>
        ))}

        <span aria-hidden className="mx-1.5 h-3.5 w-px shrink-0 bg-line" />

        {/* 排序：原生 select，零冗余文案 */}
        <label className="relative inline-flex shrink-0 items-center">
          <FaSort
            className="pointer-events-none absolute left-2.5 text-[10px] text-ink-3"
            aria-hidden
          />
          <select
            value={activeSort}
            onChange={(e) => onSortChange(e.target.value)}
            aria-label="排序方式"
            className="cursor-pointer appearance-none rounded-full bg-transparent py-1 pr-2 pl-6.5 text-xs font-medium text-ink-2 transition-colors duration-150 hover:bg-surface-2 hover:text-ink focus:outline-none"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        {/* 二级筛选入口 */}
        {(onPriorityFilterChange || onHabitFilterChange) && (
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            aria-expanded={showMore}
            className="chip"
            data-active={showMore || moreActiveCount > 0}
          >
            <FaSlidersH className="text-[10px]" />
            筛选
            {moreActiveCount > 0 && (
              <span className="tnum rounded-full bg-brand px-1.5 text-[10px] text-white">
                {moreActiveCount}
              </span>
            )}
          </button>
        )}

        {/* 完成率：唯一的进度读数，右对齐 */}
        {completionRate > 0 && (
          <span className="tnum ml-auto hidden text-[11px] text-ink-3 sm:inline">
            完成率 {completionRate}%
          </span>
        )}
      </div>

      {/* 二级筛选面板 */}
      {showMore && (
        <div className="panel-in mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-surface px-3 py-2.5">
          {onPriorityFilterChange && (
            <div className="flex items-center gap-1">
              <span className="label mr-1">优先级</span>
              <button
                type="button"
                onClick={() => onPriorityFilterChange(null)}
                data-active={activePriority == null}
                className="chip"
              >
                不限
              </button>
              {PRIORITIES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onPriorityFilterChange(p.id)}
                  data-active={activePriority === p.id}
                  className="chip"
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {onHabitFilterChange && (
            <div className="flex items-center gap-1">
              <span className="label mr-1">类型</span>
              {[
                { id: null as boolean | null, label: '不限', icon: null },
                { id: false, label: '普通', icon: <FaStar className="text-[10px]" /> },
                { id: true, label: '习惯', icon: <FaHistory className="text-[10px]" /> },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => onHabitFilterChange(o.id)}
                  data-active={activeHabitFilter === o.id}
                  className="chip"
                >
                  {o.icon}
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
