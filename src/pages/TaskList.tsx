// src/pages/TaskList.tsx
// 任务列表（核心页面）。视觉层级：
//   1) 任务行 = 页面主体，容器尽量"无边框感"，让内容而不是容器占据注意力；
//   2) 顶部只留一行工具栏：视图切换（分段控件）+ 新建任务（唯一实心主按钮）；
//   3) 统计读数只保留一处（筛选条右侧的完成率），不再重复罗列计数。
// 完成交互：点击后立即播放"打勾→上移淡出"（260ms），落库与动画并行，不阻塞手感。
import React, { useState, useEffect } from 'react';
import { TaskCompactRow } from '@/components/tasks/TaskCompactRow';
import { TaskForm } from '@/components/tasks/TaskForm';
import { TaskFilter } from '@/components/tasks/TaskFilter';
import { Task } from '../types';
import { api } from '../api';
import { PlanGeneratorWorkspace } from '../features/plan-generator/components/PlanGeneratorWorkspace';
import { FaPlus, FaCheck, FaUndo, FaTrash } from 'react-icons/fa';

type ListView = 'active' | 'history';

export const TaskList: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | undefined>(undefined);

  const [view, setView] = useState<ListView>('active');

  const [activeFilter, setActiveFilter] = useState('all');
  const [activeSort, setActiveSort] = useState('priority_asc');
  const [activePriority, setActivePriority] = useState<number | null>(null);
  const [activeHabitFilter, setActiveHabitFilter] = useState<boolean | null>(null);

  // 正在播放离场动画的任务（删除 / 完成）
  const [removingIds, setRemovingIds] = useState<ReadonlySet<number>>(new Set());
  const [doneIds, setDoneIds] = useState<ReadonlySet<number>>(new Set());

  useEffect(() => {
    loadTasks();
  }, []);

  const loadTasks = async () => {
    setLoading(true);
    try {
      const data = await api.getTasks();
      setTasks(data);
    } catch (error) {
      console.error('Failed to load tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (taskData: Omit<Task, 'id' | 'created_at'>) => {
    try {
      if (editingTask) {
        await api.updateTask(editingTask.id, taskData);
      } else {
        await api.createTask(taskData);
      }
      await loadTasks();
      setShowForm(false);
      setEditingTask(undefined);
    } catch (error) {
      console.error('Failed to save task:', error);
      alert('保存任务失败，请重试');
    }
  };

  // 删除：先收起动画，再真正删除
  const handleDelete = (id: number) => {
    if (removingIds.has(id)) return;
    if (!window.confirm('确定要删除这个任务吗？')) return;

    setRemovingIds((prev) => new Set(prev).add(id));

    window.setTimeout(() => {
      void (async () => {
        try {
          await api.deleteTask(id);
        } catch (error) {
          console.error('Failed to delete task:', error);
        }
        setTasks((prev) => prev.filter((t) => t.id !== id));
        setRemovingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      })();
    }, 180);
  };

  // 完成普通任务：立即播放动画，同时异步落库（不等待，追求干脆的速度感）
  const handleCompleteTask = (task: Task) => {
    if (doneIds.has(task.id) || removingIds.has(task.id)) return;
    const id = task.id;
    const completedAt = new Date().toISOString();

    setDoneIds((prev) => new Set(prev).add(id));

    void (async () => {
      try {
        await api.updateTask(id, { status: 'completed', completed_at: completedAt });
      } catch (error) {
        console.error('Failed to complete task:', error);
      }
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, status: 'completed', completed_at: completedAt } : t)),
      );
      setDoneIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    })();
  };

  const handleRestoreTask = async (task: Task) => {
    try {
      await api.updateTask(task.id, { status: 'pending', completed_at: null });
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id !== task.id) return t;
          const { completed_at: _ignored, ...rest } = t;
          return { ...rest, status: 'pending' as const };
        }),
      );
    } catch (error) {
      console.error('Failed to restore task:', error);
    }
  };

  const handleMarkHabitComplete = async (taskId: number, completed: boolean) => {
    try {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      const today = new Date().toISOString().split('T')[0];
      const completions = [...(task.habit_completions || [])];
      const existingIndex = completions.findIndex((c) => c.date === today);

      if (completed) {
        if (existingIndex >= 0) {
          completions[existingIndex].status = 'completed';
        } else {
          completions.push({
            date: today,
            status: 'completed',
            completed_at: new Date().toISOString(),
          });
        }
      } else if (existingIndex >= 0) {
        completions[existingIndex].status = 'skipped';
      }

      const updatedTask = { ...task, habit_completions: completions };
      setTasks((prev) => prev.map((t) => (t.id === taskId ? updatedTask : t)));
      await api.updateTask(taskId, updatedTask);
    } catch (error) {
      console.error('Failed to update habit completion:', error);
    }
  };

  // ---------------- 数据视图 ----------------
  const historyTasks = tasks
    .filter((t) => !t.is_habit && t.status === 'completed')
    .sort(
      (a, b) =>
        new Date(b.completed_at ?? b.created_at).getTime() -
        new Date(a.completed_at ?? a.created_at).getTime(),
    );

  const activePool = tasks.filter((t) => !(t.status === 'completed' && !t.is_habit));

  const filteredTasks = activePool.filter((task) => {
    if (activeFilter === 'pending' && task.status !== 'pending') return false;
    if (activeFilter === 'completed' && task.status !== 'completed') return false;
    if (activeFilter === 'habits' && !task.is_habit) return false;

    if (activeHabitFilter !== null && activeHabitFilter !== undefined) {
      if (activeHabitFilter === true && !task.is_habit) return false;
      if (activeHabitFilter === false && task.is_habit) return false;
    }

    if (activePriority !== null && task.priority !== activePriority) return false;

    if (activeFilter === 'today') {
      if (task.is_habit) {
        const dayOfWeek = new Date().getDay();
        if (task.habit_period === 'weekdays' && (dayOfWeek === 0 || dayOfWeek === 6)) return false;
        if (task.habit_period === 'weekends' && dayOfWeek >= 1 && dayOfWeek <= 5) return false;
      } else {
        if (!task.due_date) return false;
        const dueDate = new Date(task.due_date);
        const today = new Date();
        if (
          dueDate.getFullYear() !== today.getFullYear() ||
          dueDate.getMonth() !== today.getMonth() ||
          dueDate.getDate() !== today.getDate()
        ) {
          return false;
        }
      }
    }

    return true;
  });

  const sortedTasks = [...filteredTasks].sort((a, b) => {
    switch (activeSort) {
      case 'priority_asc':
        return a.priority - b.priority;
      case 'priority_desc':
        return b.priority - a.priority;
      case 'due_date':
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      case 'created':
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      case 'habit':
        if (a.is_habit && !b.is_habit) return -1;
        if (!a.is_habit && b.is_habit) return 1;
        return a.priority - b.priority;
      default:
        return 0;
    }
  });

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-ink-3">载入中…</div>
    );
  }

  const hasNoActiveTasks = activePool.length === 0;
  const isFilterEmpty = !hasNoActiveTasks && sortedTasks.length === 0;

  return (
    <div className="relative">
      {/* 工具栏 */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="seg" role="tablist" aria-label="视图">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'active'}
            data-active={view === 'active'}
            onClick={() => setView('active')}
            className="seg-item"
          >
            进行中
            <span className="tnum text-[11px] text-ink-3">{activePool.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'history'}
            data-active={view === 'history'}
            onClick={() => setView('history')}
            className="seg-item"
          >
            历史
            <span className="tnum text-[11px] text-ink-3">{historyTasks.length}</span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            setEditingTask(undefined);
            setShowForm(true);
          }}
          className="btn btn-primary shrink-0 rounded-full px-4 py-2 text-[13px] shadow-2"
        >
          <FaPlus className="text-[11px]" />
          新建任务
        </button>
      </div>

      {view === 'active' && (
        <TaskFilter
          onFilterChange={setActiveFilter}
          onSortChange={setActiveSort}
          onPriorityFilterChange={setActivePriority}
          onHabitFilterChange={setActiveHabitFilter}
          activeFilter={activeFilter}
          activeSort={activeSort}
          activePriority={activePriority}
          activeHabitFilter={activeHabitFilter}
          totalTasks={tasks.length}
          completedTasks={historyTasks.length}
        />
      )}

      {/* ============ 进行中 ============ */}
      {view === 'active' ? (
        sortedTasks.length === 0 ? (
          <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
            <h3 className="text-base font-semibold text-ink">无事可做</h3>
            <p className="max-w-xs text-sm text-ink-3">
              {isFilterEmpty
                ? '当前筛选下没有任务。'
                : hasNoActiveTasks
                  ? '还没有任务，先从一件小事开始。'
                  : '该条件下没有任务。'}
            </p>
            {isFilterEmpty ? (
              <button
                type="button"
                onClick={() => {
                  setActiveFilter('all');
                  setActivePriority(null);
                  setActiveHabitFilter(null);
                }}
                className="btn btn-ghost btn-sm"
              >
                清除筛选
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="btn btn-primary btn-sm mt-1"
              >
                <FaPlus className="text-[10px]" />
                新建任务
              </button>
            )}
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="divide-y divide-line">
              {sortedTasks.map((task, i) => {
                const busy = doneIds.has(task.id) || removingIds.has(task.id);
                return (
                  <div
                    key={task.id}
                    className={
                      doneIds.has(task.id)
                        ? 'task-done'
                        : removingIds.has(task.id)
                          ? 'task-leave'
                          : 'task-enter'
                    }
                    style={busy ? undefined : { animationDelay: `${Math.min(i, 12) * 18}ms` }}
                  >
                    <TaskCompactRow
                      task={task}
                      done={doneIds.has(task.id)}
                      onComplete={handleCompleteTask}
                      onDelete={handleDelete}
                      onEdit={() => {
                        setEditingTask(task);
                        setShowForm(true);
                      }}
                      onMarkHabitComplete={handleMarkHabitComplete}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )
      ) : (
        /* ============ 历史 ============ */
        <div className="card overflow-hidden">
          {historyTasks.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
              <h3 className="text-base font-semibold text-ink">还没有完成记录</h3>
              <p className="text-sm text-ink-3">完成的任务会归档到这里。</p>
            </div>
          ) : (
            <div className="divide-y divide-line">
              {historyTasks.map((task) => (
                <div
                  key={task.id}
                  className={`group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-surface-2 sm:px-4 ${
                    removingIds.has(task.id) ? 'task-leave' : ''
                  }`}
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ok/12 text-ok">
                    <FaCheck className="text-[9px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink-3 line-through">
                      {task.title}
                    </span>
                    <span className="tnum text-[11px] text-ink-3">
                      {task.completed_at
                        ? task.completed_at.slice(0, 10)
                        : task.created_at.slice(0, 10)}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <button
                      type="button"
                      onClick={() => void handleRestoreTask(task)}
                      title="恢复为未完成"
                      className="icon-btn"
                    >
                      <FaUndo className="text-[11px]" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(task.id)}
                      title="删除"
                      className="icon-btn hover:bg-danger-soft hover:text-danger"
                    >
                      <FaTrash className="text-[11px]" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ============ 计划生成器（次级功能，用留白和分隔线与主列表区分） ============ */}
      <div className="mt-10 border-t border-line pt-6">
        <PlanGeneratorWorkspace tasks={tasks} onTasksChanged={loadTasks} />
      </div>

      {showForm && (
        <TaskForm
          task={editingTask}
          onSubmit={handleSubmit}
          onClose={() => {
            setShowForm(false);
            setEditingTask(undefined);
          }}
          isEditing={!!editingTask}
        />
      )}
    </div>
  );
};
