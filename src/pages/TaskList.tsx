//src/pages/TaskList.tsx
// 任务列表：
// - "当前任务"视图：普通任务一旦完成 → 播放"撕便签"动画从列表消失；
//   习惯任务仍在原地，仅标记今天完成。
// - "任务历史"视图：点开显示已完成的普通任务，可恢复或删除。
// - 筛选/排序/新建/编辑均保留；能量相关功能已移除（不影响数据库）。
import React, { useState, useEffect } from 'react';
import { TaskCompactRow } from '@/components/tasks/TaskCompactRow';
import { TaskForm } from '@/components/tasks/TaskForm';
import { TaskFilter } from '@/components/tasks/TaskFilter';
import { Task } from '../types';
import { api } from '../api';
import {
  FaPlus,
  FaCheck,
  FaHistory,
  FaListUl,
  FaUndo,
  FaTrash,
  FaRegStickyNote,
} from 'react-icons/fa';

type ListView = 'active' | 'history';

export const TaskList: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | undefined>(undefined);

  // 视图切换：进行中 / 历史（已完成普通任务）
  const [view, setView] = useState<ListView>('active');

  // 筛选和排序状态
  const [activeFilter, setActiveFilter] = useState('all');
  const [activeSort, setActiveSort] = useState('priority_asc');
  const [activePriority, setActivePriority] = useState<number | null>(null);
  const [activeHabitFilter, setActiveHabitFilter] = useState<boolean | null>(null);

  // 正在播放离场动画的任务 id
  const [removingIds, setRemovingIds] = useState<ReadonlySet<number>>(new Set());
  const [tearingIds, setTearingIds] = useState<ReadonlySet<number>>(new Set());

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

  // 处理创建/更新任务（表单）
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

  // 处理删除任务：先播放离场动画，再真正删除
  const handleDelete = (id: number) => {
    if (removingIds.has(id)) return;
    if (!window.confirm('确定要删除这个任务吗？')) return;

    setRemovingIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

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
    }, 220);
  };

  // 普通任务"完成"：播放撕便签动画 → 落库 → 从当前视图消失（进入历史）
  const handleCompleteTask = (task: Task) => {
    if (tearingIds.has(task.id) || removingIds.has(task.id)) return;
    const id = task.id;
    const completedAt = new Date().toISOString();

    setTearingIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

    window.setTimeout(() => {
      void (async () => {
        try {
          await api.updateTask(id, { status: 'completed', completed_at: completedAt });
        } catch (error) {
          console.error('Failed to complete task:', error);
        }
        setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: 'completed', completed_at: completedAt } : t)));
        setTearingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      })();
    }, 430);
  };

  // 从历史恢复为未完成
  const handleRestoreTask = async (task: Task) => {
    try {
      await api.updateTask(task.id, { status: 'pending', completed_at: null } as unknown as Partial<Task>);
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

  // 处理习惯任务完成状态（今日打卡）
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
      } else {
        if (existingIndex >= 0) {
          completions[existingIndex].status = 'skipped';
        }
      }

      const updatedTask = { ...task, habit_completions: completions };
      await api.updateTask(taskId, updatedTask);
      setTasks((prev) => prev.map((t) => (t.id === taskId ? updatedTask : t)));
    } catch (error) {
      console.error('Failed to update habit completion:', error);
    }
  };

  // ---------------- 数据视图 ----------------
  // 历史：已完成的普通任务（习惯任务不进入历史，它们在原地打卡）
  const historyTasks = tasks
    .filter((t) => !t.is_habit && t.status === 'completed')
    .sort((a, b) => new Date(b.completed_at ?? b.created_at).getTime() - new Date(a.completed_at ?? a.created_at).getTime());

  // 当前池：普通未完成任务 + 全部习惯任务
  const activePool = tasks.filter((t) => !(t.status === 'completed' && !t.is_habit));

  // 当前池筛选（不含能量逻辑）
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
        const today = new Date();
        const dayOfWeek = today.getDay();
        switch (task.habit_period) {
          case 'weekdays':
            if (dayOfWeek === 0 || dayOfWeek === 6) return false;
            break;
          case 'weekends':
            if (dayOfWeek >= 1 && dayOfWeek <= 5) return false;
            break;
          default:
            break;
        }
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

  // 排序
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

  const habitCount = tasks.filter((t) => t.is_habit).length;

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-gray-500 dark:text-gray-400">加载任务中...</div>
      </div>
    );
  }

  const isHistoryEmptyFilter = view === 'active' && activeFilter === 'completed';

  return (
    <div className="max-w-6xl mx-auto relative">
      {/* 头部：标题为视觉主体，CTA 紧随其后 */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
        <button
          onClick={() => {
            setEditingTask(undefined);
            setShowForm(true);
          }}
          className="cta-pulse group inline-flex items-center justify-center gap-2.5 self-start md:self-auto px-6 py-3 rounded-full bg-gray-900 hover:bg-gray-700 dark:bg-white dark:hover:bg-gray-200 text-white dark:text-gray-900 text-sm font-semibold shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0"
        >
          <FaPlus className="w-4 h-4 transition-transform duration-200 group-hover:rotate-90" />
          新建任务
        </button>
      </div>

      {/* 视图切换：进行中 / 历史 */}
      <div className="mb-4 flex w-full items-center justify-between rounded-full bg-gray-100 dark:bg-gray-800 p-1">
        <button
          onClick={() => setView('active')}
          className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            view === 'active'
              ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
          }`}
        >
          <FaListUl className="w-3.5 h-3.5" />
          进行中
          <span className="text-[10px] text-gray-400">{activePool.length}</span>
        </button>
        <button
          onClick={() => setView('history')}
          className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            view === 'history'
              ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
          }`}
        >
          <FaHistory className="w-3.5 h-3.5" />
          任务历史
          <span className="text-[10px] text-gray-400">{historyTasks.length}</span>
        </button>
      </div>

      {/* 边缘化极简统计（单行） */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-gray-400 dark:text-gray-500">
        <span>
          共 <span className="font-semibold text-gray-700 dark:text-gray-300">{tasks.length}</span> 项
        </span>
        <span aria-hidden className="h-3 w-px bg-gray-200 dark:bg-gray-700" />
        <span>
          待办 <span className="font-semibold text-gray-700 dark:text-gray-300">{tasks.length - historyTasks.length}</span>
        </span>
        <span aria-hidden className="h-3 w-px bg-gray-200 dark:bg-gray-700" />
        <span>
          已完成 <span className="font-semibold text-gray-700 dark:text-gray-300">{historyTasks.length}</span>
        </span>
        <span aria-hidden className="h-3 w-px bg-gray-200 dark:bg-gray-700" />
        <span>习惯 {habitCount} 项</span>
      </div>

      {/* 筛选器（仅"进行中"视图） */}
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
          totalTasks={activePool.length}
          completedTasks={0}
        />
      )}

      {/* ============ 进行中列表 ============ */}
      {view === 'active' ? (
        sortedTasks.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
            <div className="text-4xl mb-4">📝</div>
            <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">无事发生</h3>
            <p className="text-gray-500 dark:text-gray-400 mb-6">
              {isHistoryEmptyFilter
                ? '已完成的任务已从列表撕下，去「任务历史」里看看吧。'
                : activePool.length === 0
                  ? '快来开始人生的第一个任务吧！'
                  : '该条件下没有任务。'}
            </p>
            {isHistoryEmptyFilter ? (
              <button
                onClick={() => setView('history')}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-gray-300 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <FaHistory className="w-3.5 h-3.5" />
                查看任务历史
              </button>
            ) : activePool.length === 0 ? (
              <button
                onClick={() => setShowForm(true)}
                className="btn btn-primary"
              >
                人生首秀！
              </button>
            ) : (
              <button
                onClick={() => setActiveFilter('all')}
                className="px-4 py-2 rounded-full border border-gray-300 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                清除筛选
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
            <div className="divide-y divide-gray-100 dark:divide-gray-700/60">
              {sortedTasks.map((task, i) => {
                const tearing = tearingIds.has(task.id);
                return (
                  <div
                    key={task.id}
                    className={
                      tearing
                        ? 'task-tear relative'
                        : removingIds.has(task.id)
                          ? 'task-leave'
                          : 'task-enter'
                    }
                    style={tearing || removingIds.has(task.id) ? undefined : { animationDelay: `${Math.min(i, 12) * 22}ms` }}
                  >
                    <TaskCompactRow
                      task={task}
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
        /* ============ 历史列表 ============ */
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          {historyTasks.length === 0 ? (
            <div className="p-12 text-center">
              <div className="text-4xl mb-4">🗂️</div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">还没有完成记录</h3>
              <p className="text-sm text-gray-400 dark:text-gray-500">完成第一个任务后，它会出现在这里。</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700/60">
              {historyTasks.map((task) => (
                <div
                  key={task.id}
                  className={`flex items-center gap-3 px-3 sm:px-4 py-2.5 ${removingIds.has(task.id) ? 'task-leave opacity-0' : ''}`}
                >
                  <span className="w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center flex-shrink-0">
                    <FaCheck className="w-3 h-3" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="block text-[15px] truncate text-gray-400 dark:text-gray-500 line-through">
                      {task.title}
                    </span>
                    <div className="text-[11px] text-gray-400 dark:text-gray-500">
                      完成于 {task.completed_at ? task.completed_at.slice(0, 10) : task.created_at.slice(0, 10)}
                    </div>
                  </div>
                  <button
                    onClick={() => void handleRestoreTask(task)}
                    title="恢复为未完成"
                    className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    <FaUndo className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(task.id)}
                    title="删除"
                    className="p-1.5 rounded-md text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <FaTrash className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 任务表单 */}
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
