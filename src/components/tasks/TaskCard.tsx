//src/components/tasks/TaskCard.tsx
import React from 'react';
import { Task } from '../../types';
import { 
  FaEdit, 
  FaTrash, 
  FaCheckCircle,
  FaClock,
  FaExclamationTriangle,
  FaCalendar,
  FaBolt,
  FaTag,
  FaFire,
  FaHistory,
  FaSync
} from 'react-icons/fa';

interface TaskCardProps {
  task: Task;
  onUpdate: (task: Task) => void;
  onDelete: (id: number) => void;
  onEdit: () => void;
  onMarkHabitComplete?: (taskId: number, completed: boolean) => void;
}

export const TaskCard: React.FC<TaskCardProps> = ({ 
  task, 
  onUpdate, 
  onDelete, 
  onEdit,
  onMarkHabitComplete
}) => {
  const getPriorityColor = (priority: number) => {
    switch (priority) {
      case 1: return 'bg-red-100 text-red-800 border-red-200';
      case 2: return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      default: return 'bg-blue-100 text-blue-800 border-blue-200';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800 border-green-200';
      case 'in_progress': return 'bg-blue-100 text-blue-800 border-blue-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <FaCheckCircle className="w-5 h-5 text-green-500" />;
      case 'in_progress':
        return <FaClock className="w-5 h-5 text-blue-500" />;
      default:
        return <FaExclamationTriangle className="w-5 h-5 text-gray-400" />;
    }
  };

  const getHabitPeriodLabel = (period?: string) => {
    switch (period) {
      case 'daily': return '每天';
      case 'weekdays': return '工作日';
      case 'weekends': return '周末';
      case 'custom': return '自定义';
      default: return '习惯';
    }
  };

  const formatDueDate = (dateString?: string) => {
    if (!dateString) return null;
    
    const date = new Date(dateString);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    if (date.toDateString() === today.toDateString()) {
      return '今天';
    } else if (date.toDateString() === tomorrow.toDateString()) {
      return '明天';
    } else {
      return date.toLocaleDateString();
    }
  };

  const dueDate = formatDueDate(task.due_date);

  // 计算习惯任务的完成率
  const calculateHabitCompletionRate = () => {
    if (!task.is_habit || !task.habit_completions || task.habit_completions.length === 0) {
      return 0;
    }
    
    const completed = task.habit_completions.filter((c: any) => c.status === 'completed').length;
    return Math.round((completed / task.habit_completions.length) * 100);
  };

  // 检查今天是否已完成习惯
  const isHabitCompletedToday = () => {
    if (!task.is_habit || !task.habit_completions) return false;
    
    const today = new Date().toISOString().split('T')[0];
    const todayCompletion = task.habit_completions.find((c: any) => 
      c.date === today && c.status === 'completed'
    );
    
    return !!todayCompletion;
  };

  const handleMarkHabitComplete = (completed: boolean) => {
    if (onMarkHabitComplete) {
      onMarkHabitComplete(task.id, completed);
    }
  };

  const habitCompletionRate = calculateHabitCompletionRate();

  return (
    <div className={`bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow border ${
      task.is_habit ? 'border-blue-200' : 'border-gray-200'
    }`}>
      {/* 头部 */}
      <div className="p-6 pb-4">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center">
            {task.is_habit ? (
              <button
                onClick={() => handleMarkHabitComplete(!isHabitCompletedToday())}
                className="mr-3"
                type="button"
              >
                <FaSync className={`w-5 h-5 ${
                  isHabitCompletedToday() ? 'text-green-500' : 'text-blue-500'
                }`} />
              </button>
            ) : (
              <button
                onClick={() => onUpdate({
                  ...task,
                  status: task.status === 'completed' ? 'pending' : 'completed'
                })}
                className="mr-3"
                type="button"
              >
                {getStatusIcon(task.status)}
              </button>
            )}
            <div>
              <h3 className={`font-semibold text-lg ${
                task.status === 'completed' ? 'line-through text-gray-500' : 'text-gray-900'
              }`}>
                {task.title}
              </h3>
              {task.is_habit && (
                <div className="flex items-center mt-1">
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-800 mr-2">
                    <FaFire className="w-3 h-3 mr-1" />
                    {getHabitPeriodLabel(task.habit_period)}
                  </span>
                  {task.habit_start_date && (
                    <span className="text-xs text-gray-500">
                      从 {new Date(task.habit_start_date).toLocaleDateString()} 开始
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex space-x-2">
            <button
              onClick={onEdit}
              className="p-2 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg"
              type="button"
            >
              <FaEdit className="w-4 h-4" />
            </button>
            <button
              onClick={() => onDelete(task.id)}
              className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
              type="button"
            >
              <FaTrash className="w-4 h-4" />
            </button>
          </div>
        </div>
        
        {/* 描述 */}
        {task.description && (
          <p className="text-gray-600 text-sm mb-4">{task.description}</p>
        )}
        
        {/* 习惯任务进度条 */}
        {task.is_habit && habitCompletionRate > 0 && (
          <div className="mb-4">
            <div className="flex justify-between text-xs text-gray-600 mb-1">
              <span>习惯完成率</span>
              <span>{habitCompletionRate}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${habitCompletionRate}%` }}
              ></div>
            </div>
            {task.habit_completions && task.habit_completions.length > 0 && (
              <div className="text-xs text-gray-500 mt-1">
                已完成 {task.habit_completions.filter((c: any) => c.status === 'completed').length} 次
              </div>
            )}
          </div>
        )}
        
        {/* 标签 */}
        {task.tags && task.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {task.tags.map(tag => (
              <span
                key={tag}
                className="inline-flex items-center px-3 py-1 rounded-full text-xs bg-gray-100 text-gray-600"
              >
                <FaTag className="w-3 h-3 mr-1" />
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
      
      {/* 底部信息栏 */}
      <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {/* 习惯标记 */}
            {task.is_habit && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border border-blue-200 bg-blue-50 text-blue-700">
                <FaHistory className="w-3 h-3 mr-1" />
                习惯任务
              </span>
            )}
            
            {/* 优先级 */}
            <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getPriorityColor(task.priority)}`}>
              {task.priority === 1 ? '高' : task.priority === 2 ? '中' : '低'}优先级
            </span>
            
            {/* 状态 */}
            <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(task.status)}`}>
              {task.status === 'completed' ? '已完成' : 
               task.status === 'in_progress' ? '进行中' : '未完成'}
            </span>
          </div>
          
          <div className="flex items-center space-x-4 text-sm text-gray-600">
            {/* 能量值 */}
            {task.energy_cost && (
              <span className="flex items-center">
                <FaBolt className="w-3 h-3 mr-1 text-yellow-500" />
                {task.energy_cost} ⚡
              </span>
            )}
            
            {/* 截止日期 */}
            {dueDate && (
              <span className="flex items-center">
                <FaCalendar className="w-3 h-3 mr-1 text-purple-500" />
                {dueDate}
              </span>
            )}
          </div>
        </div>
        
        {/* 习惯任务今天的完成状态 */}
        {task.is_habit && (
          <div className="mt-3 pt-3 border-t border-gray-200">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-600">
                {isHabitCompletedToday() ? (
                  <span className="text-green-600">✓ 今天已完成</span>
                ) : (
                  <span className="text-blue-600">今天待完成</span>
                )}
              </div>
              <button
                onClick={() => handleMarkHabitComplete(!isHabitCompletedToday())}
                className={`px-3 py-1 rounded text-xs ${
                  isHabitCompletedToday()
                    ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    : 'bg-green-100 text-green-700 hover:bg-green-200'
                }`}
                type="button"
              >
                {isHabitCompletedToday() ? '标记为未完成' : '标记为已完成'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};