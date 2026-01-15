//src/pages/TaskList.tsx
import React, { useState, useEffect } from 'react';
import { TaskCard } from '@/components/tasks/TaskCard';
import { TaskForm } from '@/components/tasks/TaskForm';
import { TaskFilter } from '@/components/tasks/TaskFilter';
import { Task } from '../types';
import { api } from '../api';
import { FaPlus, FaList, FaCalendarCheck } from 'react-icons/fa';

export const TaskList: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | undefined>(undefined);
  
  // 筛选和排序状态
  const [activeFilter, setActiveFilter] = useState('all');
  const [activeSort, setActiveSort] = useState('priority_asc');
  const [activePriority, setActivePriority] = useState<number | null>(null);
  const [activeEnergyRange, setActiveEnergyRange] = useState({ min: 1, max: 10 });

  // 加载任务
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

  // 处理创建/更新任务
  const handleSubmit = async (taskData: Omit<Task, 'id' | 'created_at'>) => {
    try {
      if (editingTask) {
        // 更新现有任务 - 这里需要更新API调用
        // await api.updateTask(editingTask.id, taskData);
        alert('Update task functionality to be implemented');
      } else {
        await api.createTask(taskData);
      }
      await loadTasks();
      setShowForm(false);
      setEditingTask(undefined);
    } catch (error) {
      console.error('Failed to save task:', error);
    }
  };

  // 处理更新任务
  const handleUpdate = (updatedTask: Task) => {
    setTasks(tasks.map(t => t.id === updatedTask.id ? updatedTask : t));
  };

  // 处理删除任务
  const handleDelete = async (id: number) => {
    if (window.confirm('Are you sure you want to delete this task?')) {
      try {
        await api.deleteTask(id);
        setTasks(tasks.filter(t => t.id !== id));
      } catch (error) {
        console.error('Failed to delete task:', error);
      }
    }
  };

  // 筛选任务
  const filteredTasks = tasks.filter(task => {
    // 基础筛选
    if (activeFilter === 'pending' && task.status !== 'pending') return false;
    if (activeFilter === 'completed' && task.status !== 'completed') return false;
    if (activeFilter === 'high_energy' && (!task.energy_cost || task.energy_cost < 7)) return false;
    
    // 优先级筛选
    if (activePriority !== null && task.priority !== activePriority) return false;
    
    // 能量消耗筛选
    if (task.energy_cost) {
      if (task.energy_cost < activeEnergyRange.min || task.energy_cost > activeEnergyRange.max) return false;
    }
    
    return true;
  });

  // 排序任务
  const sortedTasks = [...filteredTasks].sort((a, b) => {
    switch (activeSort) {
      case 'priority_asc':
        return a.priority - b.priority; // 低到高
      case 'priority_desc':
        return b.priority - a.priority; // 高到低
      case 'due_date':
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      case 'energy':
        if (!a.energy_cost) return 1;
        if (!b.energy_cost) return -1;
        return (b.energy_cost || 0) - (a.energy_cost || 0);
      case 'created':
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      default:
        return 0;
    }
  });

  // 统计信息
  const completedTasks = tasks.filter(task => task.status === 'completed').length;
  const totalEnergy = tasks.reduce((sum, task) => sum + (task.energy_cost || 0), 0);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-gray-500">Loading tasks...</div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* 头部 */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Task Manager</h1>
          <p className="text-gray-600 mt-2">
           管理任务，追踪项目，记录心情
          </p>
        </div>
        <div className="flex items-center space-x-3 mt-4 md:mt-0">
          <button
            onClick={() => {
              setEditingTask(undefined);
              setShowForm(true);
            }}
            className="btn btn-primary flex items-center"
          >
            <FaPlus className="w-4 h-4 mr-2" />
            新任务
          </button>
        </div>
      </div>

      {/* 筛选器 */}
      <TaskFilter
        onFilterChange={setActiveFilter}
        onSortChange={setActiveSort}
        onPriorityFilterChange={setActivePriority}
        onEnergyFilterChange={(min, max) => setActiveEnergyRange({ min, max })}
        activeFilter={activeFilter}
        activeSort={activeSort}
        activePriority={activePriority}
        activeEnergyRange={activeEnergyRange}
        totalTasks={tasks.length}
        completedTasks={completedTasks}
      />

      {/* 任务列表 */}
      {sortedTasks.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <div className="text-4xl mb-4">📝</div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">
            无事发生
          </h3>
          <p className="text-gray-600 mb-6">
            {tasks.length === 0 
              ? "快来开始人生的第一个任务吧！" 
              : "该条件下没有任务，好诶."
            }
          </p>
          {tasks.length === 0 && (
            <button
              onClick={() => setShowForm(true)}
              className="btn btn-primary"
            >
              人生首秀！
            </button>
          )}
        </div>
      ) : (
        <>
          {/* 任务统计 */}
          <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-xl shadow-sm p-4 flex items-center">
              <div className="p-3 bg-blue-50 rounded-lg mr-4">
                <FaList className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <div className="text-sm text-gray-600">任务数</div>
                <div className="text-2xl font-bold text-gray-900">{tasks.length}</div>
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-4 flex items-center">
              <div className="p-3 bg-green-50 rounded-lg mr-4">
                <FaCalendarCheck className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <div className="text-sm text-gray-600">完成数</div>
                <div className="text-2xl font-bold text-gray-900">
                  {completedTasks} ({Math.round((completedTasks / tasks.length) * 100)}%)
                </div>
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-4 flex items-center">
              <div className="p-3 bg-yellow-50 rounded-lg mr-4">
                <FaPlus className="w-6 h-6 text-yellow-600" />
              </div>
              <div>
                <div className="text-sm text-gray-600">总能量</div>
                <div className="text-2xl font-bold text-gray-900">
                  {totalEnergy} ⚡
                </div>
              </div>
            </div>
          </div>

          {/* 任务网格 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {sortedTasks.map(task => (
              <TaskCard
                key={task.id}
                task={task}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
                onEdit={() => {
                  setEditingTask(task);
                  setShowForm(true);
                }}
              />
            ))}
          </div>
        </>
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