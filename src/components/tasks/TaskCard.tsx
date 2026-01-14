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
  FaTag
} from 'react-icons/fa';

interface TaskCardProps {
  task: Task;
  onUpdate: (task: Task) => void;
  onDelete: (id: number) => void;
  onEdit: () => void;
}

export const TaskCard: React.FC<TaskCardProps> = ({ task, onUpdate, onDelete, onEdit }) => {
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

  const formatDueDate = (dateString?: string) => {
    if (!dateString) return null;
    
    const date = new Date(dateString);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === tomorrow.toDateString()) {
      return 'Tomorrow';
    } else {
      return date.toLocaleDateString();
    }
  };

  const dueDate = formatDueDate(task.due_date);

  return (
    <div className="bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow border border-gray-200">
      {/* 头部 */}
      <div className="p-6 pb-4">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center">
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
            <h3 className={`font-semibold text-lg ${
              task.status === 'completed' ? 'line-through text-gray-500' : 'text-gray-900'
            }`}>
              {task.title}
            </h3>
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
            {/* 优先级 */}
            <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getPriorityColor(task.priority)}`}>
              {task.priority === 1 ? 'High' : task.priority === 2 ? 'Medium' : 'Low'}
            </span>
            
            {/* 状态 */}
            <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(task.status)}`}>
              {task.status === 'completed' ? 'Completed' : 
               task.status === 'in_progress' ? 'In Progress' : 'Pending'}
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
            
            {/* 预估时间 */}
            {task.estimated_time && (
              <span className="flex items-center">
                <FaClock className="w-3 h-3 mr-1 text-blue-500" />
                {task.estimated_time}m
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
      </div>
    </div>
  );
};