//src//components/tasks/TaskForm.tsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { format } from 'date-fns';
import { Task } from '../../types';
import { 
  FaTimes, 
  FaCalendarAlt, 
  FaTag,
  FaFire,
  FaHistory,
  FaSync
} from 'react-icons/fa';

interface TaskFormProps {
  task?: Task;
  onSubmit: (taskData: Omit<Task, 'id' | 'created_at'>) => void;
  onClose: () => void;
  isEditing?: boolean;
}

const TAG_OPTIONS = [
  '工作', '个人', '健康', '学习', '购物',
  '会议', '项目', '紧急', '家庭', '健身', '习惯'
];

const PRIORITY_OPTIONS = [
  { value: 1, label: '高', color: 'text-red-600' },
  { value: 2, label: '中', color: 'text-yellow-600' },
  { value: 3, label: '低', color: 'text-blue-600' }
];

const HABIT_PERIOD_OPTIONS = [
  { value: 'daily', label: '每天' },
  { value: 'weekdays', label: '工作日（周一至周五）' },
  { value: 'weekends', label: '周末（周六、周日）' },
  { value: 'custom', label: '自定义' }
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
     task?.estimated_time, task?.due_date, 
     JSON.stringify(task?.tags), task?.status, task?.is_habit,
     task?.habit_period, task?.habit_start_date, task?.habit_end_date,
     JSON.stringify(task?.habit_completions)]);

  const [formData, setFormData] = useState({
    title: stableTask?.title || '',
    description: stableTask?.description || '',
    priority: stableTask?.priority || 2 as 1 | 2 | 3,
    estimated_time: stableTask?.estimated_time || 30,
    due_date: stableTask?.due_date || '',
    tags: stableTask?.tags || [] as string[],
    status: stableTask?.status || 'pending',
    // 习惯任务字段
    is_habit: stableTask?.is_habit || false,
    habit_period: stableTask?.habit_period || 'daily' as 'daily' | 'weekdays' | 'weekends' | 'custom',
    habit_completions: stableTask?.habit_completions || [],
    habit_start_date: stableTask?.habit_start_date || '',
    habit_end_date: stableTask?.habit_end_date || ''
  });

  const [selectedTag, setSelectedTag] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (stableTask) {
      setFormData({
        title: stableTask.title || '',
        description: stableTask.description || '',
        priority: stableTask.priority || 2,
        estimated_time: stableTask.estimated_time || 30,
        due_date: stableTask.due_date || '',
        tags: stableTask.tags || [],
        status: stableTask.status || 'pending',
        // 习惯任务字段
        is_habit: stableTask.is_habit || false,
        habit_period: stableTask.habit_period || 'daily',
        habit_completions: stableTask.habit_completions || [],
        habit_start_date: stableTask.habit_start_date || '',
        habit_end_date: stableTask.habit_end_date || ''
      });
    } else {
      // 如果是新建任务，默认设置习惯开始日期为今天
      const today = new Date().toISOString().split('T')[0];
      setFormData(prev => ({
        ...prev,
        habit_start_date: today
      }));
    }
  }, [stableTask]);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.title.trim()) {
      newErrors.title = '标题是必填项';
    }

    if (formData.estimated_time && formData.estimated_time < 1) {
      newErrors.estimated_time = '预估时间必须至少为 1 分钟';
    }

    if (formData.due_date) {
      const dueDate = new Date(formData.due_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      if (dueDate < today) {
        newErrors.due_date = '截止日期不能是过去的时间';
      }
    }

    if (formData.is_habit) {
      if (!formData.habit_start_date) {
        newErrors.habit_start_date = '习惯开始日期是必填项';
      }
      
      if (formData.habit_end_date && formData.habit_start_date) {
        const startDate = new Date(formData.habit_start_date);
        const endDate = new Date(formData.habit_end_date);
        
        if (endDate < startDate) {
          newErrors.habit_end_date = '习惯结束日期不能早于开始日期';
        }
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
      estimated_time: formData.estimated_time || undefined,
      due_date: formData.due_date || undefined,
      tags: formData.tags.length > 0 ? formData.tags : undefined,
      // 习惯任务字段
      is_habit: formData.is_habit,
      habit_period: formData.is_habit ? formData.habit_period : undefined,
      habit_completions: formData.is_habit ? formData.habit_completions : undefined,
      habit_start_date: formData.is_habit ? formData.habit_start_date : undefined,
      habit_end_date: formData.is_habit ? (formData.habit_end_date || undefined) : undefined
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

  const toggleIsHabit = () => {
    const newIsHabit = !formData.is_habit;
    const today = new Date().toISOString().split('T')[0];
    
    setFormData({
      ...formData,
      is_habit: newIsHabit,
      habit_start_date: newIsHabit && !formData.habit_start_date ? today : formData.habit_start_date
    });
  };

  // 点击背景关闭表单
  const handleBackgroundClick = (e: React.MouseEvent) => {
    if (formRef.current && !formRef.current.contains(e.target as Node)) {
      onClose();
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50"
      onClick={handleBackgroundClick}
      onKeyDown={handleKeyDown}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        zIndex: 50,
        padding: '1rem'
      }}
    >
      <div 
        ref={formRef}
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl flex flex-col"
        style={{
          backgroundColor: 'white',
          borderRadius: '0.75rem',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          width: '100%',
          maxWidth: '42rem',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 'calc(100vh - 2rem)',
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 - 固定 */}
        <div className="flex items-center justify-between p-6 border-b bg-white">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              {isEditing ? '编辑任务' : '创建任务'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            type="button"
          >
            <FaTimes className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* 表单内容 - 可滚动 */}
        <div className="flex-1 overflow-y-auto">
          <form onSubmit={handleSubmit} className="p-6">
            <div className="space-y-6">
              {/* 标题 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  任务标题
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({...formData, title: e.target.value})}
                  className={`input ${errors.title ? 'border-red-500' : ''}`}
                  placeholder="做点什么呢？"
                  autoFocus
                />
                {errors.title && (
                  <p className="mt-1 text-sm text-red-600">{errors.title}</p>
                )}
              </div>

              {/* 描述 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  描述
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                  className="input min-h-[100px]"
                  placeholder="填入具体细节"
                  rows={3}
                />
              </div>

              {/* 任务类型切换 */}
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center">
                  <FaHistory className="w-5 h-5 text-blue-500 mr-3" />
                  <div>
                    <div className="font-medium text-gray-900">习惯任务</div>
                    <div className="text-sm text-gray-600">设置为需要每天/每周重复完成的任务</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={toggleIsHabit}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full ${
                    formData.is_habit ? 'bg-blue-600' : 'bg-gray-200'
                  }`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                    formData.is_habit ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                </button>
              </div>

              {/* 习惯任务配置 */}
              {formData.is_habit && (
                <div className="space-y-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="flex items-center mb-2">
                    <FaFire className="w-4 h-4 text-blue-500 mr-2" />
                    <h3 className="font-medium text-gray-900">习惯任务设置</h3>
                  </div>

                  {/* 习惯周期 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      重复周期
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {HABIT_PERIOD_OPTIONS.map(option => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setFormData({...formData, habit_period: option.value as any})}
                          className={`py-2 px-3 rounded-lg border text-sm ${
                            formData.habit_period === option.value
                              ? 'bg-blue-100 border-blue-300 text-blue-700 font-medium'
                              : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 习惯日期范围 */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        开始日期
                      </label>
                      <input
                        type="date"
                        value={formData.habit_start_date}
                        onChange={(e) => setFormData({...formData, habit_start_date: e.target.value})}
                        className={`input ${errors.habit_start_date ? 'border-red-500' : ''}`}
                      />
                      {errors.habit_start_date && (
                        <p className="mt-1 text-sm text-red-600">{errors.habit_start_date}</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        结束日期（可选）
                      </label>
                      <input
                        type="date"
                        value={formData.habit_end_date}
                        onChange={(e) => setFormData({...formData, habit_end_date: e.target.value})}
                        min={formData.habit_start_date}
                        className={`input ${errors.habit_end_date ? 'border-red-500' : ''}`}
                      />
                      {errors.habit_end_date && (
                        <p className="mt-1 text-sm text-red-600">{errors.habit_end_date}</p>
                      )}
                    </div>
                  </div>

                  {/* 习惯说明 */}
                  <div className="text-xs text-gray-600 bg-white p-3 rounded border">
                    <FaSync className="w-3 h-3 inline mr-1" />
                    {formData.habit_period === 'daily' && '此任务将每天重复，直到结束日期或手动停止。'}
                    {formData.habit_period === 'weekdays' && '此任务将在工作日（周一至周五）重复。'}
                    {formData.habit_period === 'weekends' && '此任务将在周末（周六、周日）重复。'}
                    {formData.habit_period === 'custom' && '此任务将按照自定义周期重复。'}
                  </div>
                </div>
              )}

              {/* 优先级（状态不在这里改：见下方提示） */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  优先级
                </label>
                <div className="flex space-x-2">
                  {PRIORITY_OPTIONS.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setFormData({...formData, priority: option.value as 1 | 2 | 3})}
                      className={`flex-1 py-3 px-4 rounded-lg border transition-all ${
                        formData.priority === option.value
                          ? `${option.value === 1 ? 'bg-red-50 border-red-200 text-red-700' : 
                              option.value === 2 ? 'bg-yellow-50 border-yellow-200 text-yellow-700' : 
                              'bg-blue-50 border-blue-200 text-blue-700'} font-medium`
                          : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {/* 状态改由任务行上的徽标点击切换：一处入口，避免两处口径不一致 */}
                {!formData.is_habit && (
                  <p className="mt-3 text-xs text-gray-500">
                    状态（暂缓 / 进行中 / 完成）在任务行上点徽标直接切换，这里不再重复设置。
                  </p>
                )}
              </div>

              {/* 截止日期 - 如果不是习惯任务才显示 */}
              {!formData.is_habit && (
                <div>
                  <label className="flex items-center text-sm font-medium text-gray-700 mb-2">
                    <FaCalendarAlt className="w-4 h-4 mr-2 text-purple-500" />
                    截止日期
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
              )}

              {/* 标签 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="flex items-center text-sm font-medium text-gray-700">
                    <FaTag className="w-4 h-4 mr-2 text-green-500" />
                    标签 (可选)
                  </label>
                  <span className="text-xs text-gray-500">
                    {formData.tags.length}/5 标签
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
                      <option value="">选择一个标签...</option>
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
                      添加标签
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
                className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                取消
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!formData.title.trim()}
              >
                {isEditing ? '更新任务' : formData.is_habit ? '创建习惯任务' : '创建任务'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};