//src//components/tasks/TaskForm.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { format } from 'date-fns';
import { Task } from '../../types';
import { FaTimes, FaCalendarAlt, FaClock, FaBolt, FaTag } from 'react-icons/fa';

interface TaskFormProps {
  task?: Task;
  onSubmit: (taskData: Omit<Task, 'id' | 'created_at'>) => void;
  onClose: () => void;
  isEditing?: boolean;
}

const TAG_OPTIONS = [
  'Work', 'Personal', 'Health', 'Learning', 'Shopping',
  'Meeting', 'Project', 'Urgent', 'Home', 'Fitness'
];

const PRIORITY_OPTIONS = [
  { value: 1, label: 'High', color: 'text-red-600' },
  { value: 2, label: 'Medium', color: 'text-yellow-600' },
  { value: 3, label: 'Low', color: 'text-blue-600' }
];

export const TaskForm: React.FC<TaskFormProps> = ({
  task,
  onSubmit,
  onClose,
  isEditing = false
}) => {
  // 使用 useMemo 确保 task 引用稳定
  const stableTask = useMemo(() => task, 
    [task?.id, task?.title, task?.description, task?.priority, 
     task?.energy_cost, task?.estimated_time, task?.due_date, 
     JSON.stringify(task?.tags), task?.status]);

  const [formData, setFormData] = useState({
    title: stableTask?.title || '',
    description: stableTask?.description || '',
    priority: stableTask?.priority || 2 as 1 | 2 | 3,
    energy_cost: stableTask?.energy_cost || 5,
    estimated_time: stableTask?.estimated_time || 30,
    due_date: stableTask?.due_date || '',
    tags: stableTask?.tags || [] as string[],
    status: stableTask?.status || 'pending'
  });

  const [selectedTag, setSelectedTag] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (stableTask) {
      setFormData({
        title: stableTask.title || '',
        description: stableTask.description || '',
        priority: stableTask.priority || 2,
        energy_cost: stableTask.energy_cost || 5,
        estimated_time: stableTask.estimated_time || 30,
        due_date: stableTask.due_date || '',
        tags: stableTask.tags || [],
        status: stableTask.status || 'pending'
      });
    }
  }, [stableTask]);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.title.trim()) {
      newErrors.title = 'Title is required';
    }

    if (formData.energy_cost < 1 || formData.energy_cost > 10) {
      newErrors.energy_cost = 'Energy cost must be between 1 and 10';
    }

    if (formData.estimated_time && formData.estimated_time < 1) {
      newErrors.estimated_time = 'Estimated time must be at least 1 minute';
    }

    if (formData.due_date) {
      const dueDate = new Date(formData.due_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      if (dueDate < today) {
        newErrors.due_date = 'Due date cannot be in the past';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    const taskData = {
      title: formData.title.trim(),
      description: formData.description.trim() || undefined,
      status: formData.status as 'pending' | 'in_progress' | 'completed',
      priority: formData.priority,
      energy_cost: formData.energy_cost || undefined,
      estimated_time: formData.estimated_time || undefined,
      due_date: formData.due_date || undefined,
      tags: formData.tags.length > 0 ? formData.tags : undefined
    };

    onSubmit(taskData);
    onClose();
  };

  const handleAddTag = () => {
    if (selectedTag && !formData.tags.includes(selectedTag) && formData.tags.length < 5) {
      setFormData({
        ...formData,
        tags: [...formData.tags, selectedTag]
      });
      setSelectedTag('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setFormData({
      ...formData,
      tags: formData.tags.filter(tag => tag !== tagToRemove)
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div 
        className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              {isEditing ? 'Edit Task' : 'Create New Task'}
            </h2>
            <p className="text-gray-600 text-sm mt-1">
              {isEditing ? 'Update your task details' : 'Add a new task to your list'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            type="button"
          >
            <FaTimes className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* 表单内容 */}
        <form onSubmit={handleSubmit} className="p-6">
          <div className="space-y-6">
            {/* 标题 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Task Title *
              </label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({...formData, title: e.target.value})}
                className={`input ${errors.title ? 'border-red-500' : ''}`}
                placeholder="What needs to be done?"
                autoFocus
              />
              {errors.title && (
                <p className="mt-1 text-sm text-red-600">{errors.title}</p>
              )}
            </div>

            {/* 描述 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Description (Optional)
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({...formData, description: e.target.value})}
                className="input min-h-[100px]"
                placeholder="Add more details about this task..."
                rows={3}
              />
            </div>

            {/* 优先级和状态 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* 优先级 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Priority
                </label>
                <div className="flex space-x-2">
                  {PRIORITY_OPTIONS.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setFormData({...formData, priority: option.value as 1 | 2 | 3})}
                      className={`
                        flex-1 py-3 px-4 rounded-lg border transition-all
                        ${formData.priority === option.value
                          ? `${option.value === 1 ? 'bg-red-50 border-red-200 text-red-700' : 
                              option.value === 2 ? 'bg-yellow-50 border-yellow-200 text-yellow-700' : 
                              'bg-blue-50 border-blue-200 text-blue-700'} font-medium`
                          : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                        }
                      `}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 状态 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Status
                </label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({...formData, status: e.target.value as Task['status']})}
                  className="input"
                >
                  <option value="pending">Pending</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
            </div>

            {/* 能量消耗和预估时间 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* 能量消耗 */}
              <div>
                <label className="flex items-center text-sm font-medium text-gray-700 mb-2">
                  <FaBolt className="w-4 h-4 mr-2 text-yellow-500" />
                  Energy Cost (1-10)
                </label>
                <div>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={formData.energy_cost}
                    onChange={(e) => setFormData({...formData, energy_cost: parseInt(e.target.value)})}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                  />
                  <div className="flex justify-between mt-2">
                    <span className="text-sm text-gray-500">Low (1)</span>
                    <span className="font-medium">{formData.energy_cost}</span>
                    <span className="text-sm text-gray-500">High (10)</span>
                  </div>
                </div>
                {errors.energy_cost && (
                  <p className="mt-1 text-sm text-red-600">{errors.energy_cost}</p>
                )}
              </div>

              {/* 预估时间 */}
              <div>
                <label className="flex items-center text-sm font-medium text-gray-700 mb-2">
                  <FaClock className="w-4 h-4 mr-2 text-blue-500" />
                  Estimated Time (minutes)
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    type="number"
                    min="1"
                    value={formData.estimated_time}
                    onChange={(e) => setFormData({...formData, estimated_time: parseInt(e.target.value) || 0})}
                    className={`input ${errors.estimated_time ? 'border-red-500' : ''}`}
                  />
                  <span className="text-gray-500 whitespace-nowrap">minutes</span>
                </div>
                {errors.estimated_time && (
                  <p className="mt-1 text-sm text-red-600">{errors.estimated_time}</p>
                )}
              </div>
            </div>

            {/* 截止日期 */}
            <div>
              <label className="flex items-center text-sm font-medium text-gray-700 mb-2">
                <FaCalendarAlt className="w-4 h-4 mr-2 text-purple-500" />
                Due Date (Optional)
              </label>
              <input
                type="date"
                value={formData.due_date}
                onChange={(e) => setFormData({...formData, due_date: e.target.value})}
                min={format(new Date(), 'yyyy-MM-dd')}
                className={`input ${errors.due_date ? 'border-red-500' : ''}`}
              />
              {errors.due_date && (
                <p className="mt-1 text-sm text-red-600">{errors.due_date}</p>
              )}
            </div>

            {/* 标签 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="flex items-center text-sm font-medium text-gray-700">
                  <FaTag className="w-4 h-4 mr-2 text-green-500" />
                  Tags (Optional)
                </label>
                <span className="text-xs text-gray-500">
                  {formData.tags.length}/5 tags
                </span>
              </div>

              {/* 已选择的标签 */}
              {formData.tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-4">
                  {formData.tags.map(tag => (
                    <span
                      key={tag}
                      className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-primary-100 text-primary-800"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        className="ml-2 text-primary-600 hover:text-primary-800"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* 添加标签 */}
              {formData.tags.length < 5 && (
                <div className="flex gap-2">
                  <select
                    value={selectedTag}
                    onChange={(e) => setSelectedTag(e.target.value)}
                    className="flex-1 input"
                  >
                    <option value="">Select a tag...</option>
                    {TAG_OPTIONS
                      .filter(tag => !formData.tags.includes(tag))
                      .map(tag => (
                        <option key={tag} value={tag}>{tag}</option>
                      ))
                    }
                  </select>
                  <button
                    type="button"
                    onClick={handleAddTag}
                    className="btn btn-secondary whitespace-nowrap"
                    disabled={!selectedTag}
                  >
                    Add Tag
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 底部按钮 */}
          <div className="flex justify-end space-x-3 pt-8 mt-8 border-t">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!formData.title.trim()}
            >
              {isEditing ? 'Update Task' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};