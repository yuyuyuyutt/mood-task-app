//src/components/tasks/TaskFilter.tsx
import React, { useState } from 'react';
import { 
  FaFilter, 
  FaCalendar, 
  FaCheck, 
  FaClock, 
  FaFire, 
  FaSortAmountDown, 
  FaSortAmountUp,
  FaHistory,
  FaStar
} from 'react-icons/fa';

interface FilterOption {
  id: string;
  label: string;
  icon: React.ReactNode;
}

interface SortOption {
  id: string;
  label: string;
  icon: React.ReactNode;
}

interface TaskFilterProps {
  onFilterChange: (filter: string) => void;
  onSortChange: (sort: string) => void;
  onPriorityFilterChange?: (priority: number | null) => void;
  onEnergyFilterChange?: (min: number, max: number) => void;
  onHabitFilterChange?: (showHabits: boolean | null) => void;
  activeFilter: string;
  activeSort: string;
  activePriority?: number | null;
  activeEnergyRange?: { min: number; max: number };
  activeHabitFilter?: boolean | null;
  totalTasks: number;
  completedTasks: number;
}

export const TaskFilter: React.FC<TaskFilterProps> = ({
  onFilterChange,
  onSortChange,
  onPriorityFilterChange,
  onEnergyFilterChange,
  onHabitFilterChange,
  activeFilter,
  activeSort,
  activePriority,
  activeEnergyRange,
  activeHabitFilter,
  totalTasks,
  completedTasks
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const filterOptions = [
    { id: 'all', label: '展示所有', icon: <FaFilter className="w-4 h-4" /> },
    { id: 'today', label: '今日的', icon: <FaCalendar className="w-4 h-4" /> },
    { id: 'pending', label: '未完成', icon: <FaClock className="w-4 h-4" /> },
    { id: 'completed', label: '已完成', icon: <FaCheck className="w-4 h-4" /> },
    { id: 'habits', label: '习惯任务', icon: <FaHistory className="w-4 h-4" /> },
    { id: 'high_energy', label: '高能量', icon: <FaFire className="w-4 h-4" /> },
  ];

  const sortOptions = [
    { id: 'priority_asc', label: '优先级（高到低）', icon: <FaSortAmountDown className="w-4 h-4" /> },
    { id: 'priority_desc', label: '优先级（低到高）', icon: <FaSortAmountUp className="w-4 h-4" /> },
    { id: 'due_date', label: '截止日期', icon: <FaCalendar className="w-4 h-4" /> },
    { id: 'energy', label: '能量消耗', icon: <FaFire className="w-4 h-4" /> },
    { id: 'created', label: '创建日期', icon: <FaSortAmountDown className="w-4 h-4" /> },
    { id: 'habit', label: '习惯任务优先', icon: <FaHistory className="w-4 h-4" /> },
  ];

  const priorityOptions = [
    { id: null, label: '全部优先级', color: 'bg-gray-200 text-gray-800' },
    { id: 1, label: '高', color: 'bg-red-100 text-red-800' },
    { id: 2, label: '中', color: 'bg-yellow-100 text-yellow-800' },
    { id: 3, label: '低', color: 'bg-blue-100 text-blue-800' },
  ];

  const energyRanges = [
    { id: 'all', label: '全部', min: 1, max: 10 },
    { id: 'low', label: '低（1-3）', min: 1, max: 3 },
    { id: 'medium', label: '中（4-7）', min: 4, max: 7 },
    { id: 'high', label: '高（8-10）', min: 8, max: 10 },
  ];

  const habitOptions = [
    { id: null, label: '全部任务', icon: <FaFilter className="w-4 h-4" /> },
    { id: true, label: '仅习惯任务', icon: <FaHistory className="w-4 h-4" /> },
    { id: false, label: '仅普通任务', icon: <FaStar className="w-4 h-4" /> },
  ];

  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return (
    <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
      {/* 顶部统计信息 */}
      <div className="flex flex-wrap items-center justify-between mb-6">
        <div>
          <div className="text-sm text-gray-600">任务统计</div>
          <div className="text-2xl font-bold text-gray-900">{totalTasks} 个任务</div>
          <div className="text-sm text-gray-600 mt-1">
            完成率: <span className="font-medium text-green-600">{completionRate}%</span>
          </div>
        </div>
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-sm text-primary-600 hover:text-primary-700 flex items-center"
          type="button"
        >
          <FaFilter className="w-4 h-4 mr-1" />
          {showAdvanced ? '收起高级筛选' : '展开高级筛选'}
        </button>
      </div>

      {/* 基础筛选器 */}
      <div className="mb-6">
        <div className="flex items-center mb-3">
          <FaFilter className="w-4 h-4 text-gray-500 mr-2" />
          <span className="text-sm font-medium text-gray-700">筛选</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {filterOptions.map(option => (
            <button
              key={option.id}
              onClick={() => onFilterChange(option.id)}
              className={`
                flex items-center px-4 py-2 rounded-lg text-sm transition-colors
                ${activeFilter === option.id
                  ? 'bg-primary-100 text-primary-700 border border-primary-300'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }
              `}
              type="button"
            >
              <span className="mr-2">{option.icon}</span>
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* 高级筛选器 */}
      {showAdvanced && (
        <div className="border-t pt-6 space-y-6">
          {/* 任务类型筛选 */}
          {onHabitFilterChange && (
            <div>
              <div className="flex items-center mb-3">
                <FaHistory className="w-4 h-4 text-gray-500 mr-2" />
                <span className="text-sm font-medium text-gray-700">任务类型</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {habitOptions.map(option => (
                  <button
                    key={option.id === null ? 'all' : option.id ? 'habit' : 'normal'}
                    onClick={() => onHabitFilterChange(option.id)}
                    className={`
                      flex items-center px-4 py-2 rounded-lg text-sm transition-colors
                      ${activeHabitFilter === option.id
                        ? 'bg-primary-100 text-primary-700 border border-primary-300'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }
                    `}
                    type="button"
                  >
                    <span className="mr-2">{option.icon}</span>
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 优先级筛选 */}
          {onPriorityFilterChange && (
            <div>
              <div className="flex items-center mb-3">
                <span className="text-sm font-medium text-gray-700">优先级</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {priorityOptions.map(option => (
                  <button
                    key={option.id === null ? 'all' : option.id}
                    onClick={() => onPriorityFilterChange(option.id)}
                    className={`
                      px-4 py-2 rounded-lg text-sm transition-colors ${option.color}
                      ${activePriority === option.id ? 'ring-2 ring-primary-500' : ''}
                    `}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 能量消耗筛选 */}
          {onEnergyFilterChange && (
            <div>
              <div className="flex items-center mb-3">
                <FaFire className="w-4 h-4 text-gray-500 mr-2" />
                <span className="text-sm font-medium text-gray-700">能量范围</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {energyRanges.map(range => (
                  <button
                    key={range.id}
                    onClick={() => onEnergyFilterChange(range.min, range.max)}
                    className={`
                      px-4 py-2 rounded-lg text-sm transition-colors
                      ${activeEnergyRange?.min === range.min && activeEnergyRange?.max === range.max
                        ? 'bg-primary-100 text-primary-700 border border-primary-300'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }
                    `}
                    type="button"
                  >
                    {range.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 排序选项 */}
          <div>
            <div className="flex items-center mb-3">
              <FaSortAmountDown className="w-4 h-4 text-gray-500 mr-2" />
              <span className="text-sm font-medium text-gray-700">排序方式</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {sortOptions.map(option => (
                <button
                  key={option.id}
                  onClick={() => onSortChange(option.id)}
                  className={`
                    flex items-center justify-center px-4 py-3 rounded-lg text-sm transition-colors
                    ${activeSort === option.id
                      ? 'bg-primary-100 text-primary-700 border border-primary-300'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }
                  `}
                  type="button"
                >
                  <span className="mr-2">{option.icon}</span>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 当前筛选状态 */}
      <div className="mt-6 pt-6 border-t">
        <div className="text-sm text-gray-600">
          <span className="font-medium">正在显示：</span>{' '}
          {activeFilter !== 'all' && (
            <span className="inline-flex items-center px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs ml-2">
              {filterOptions.find(f => f.id === activeFilter)?.label}
            </span>
          )}
          {activeHabitFilter !== null && activeHabitFilter !== undefined && (
            <span className="inline-flex items-center px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs ml-2">
              {habitOptions.find(h => h.id === activeHabitFilter)?.label}
            </span>
          )}
          {activePriority !== null && activePriority !== undefined && (
            <span className="inline-flex items-center px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs ml-2">
              {priorityOptions.find(p => p.id === activePriority)?.label}
            </span>
          )}
          {activeEnergyRange && activeEnergyRange.min !== 1 && activeEnergyRange.max !== 10 && (
            <span className="inline-flex items-center px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs ml-2">
              能量: {activeEnergyRange.min}-{activeEnergyRange.max}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};