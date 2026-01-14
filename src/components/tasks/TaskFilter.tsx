//src/components/tasks/TaskFilter.tsx
import React, { useState } from 'react';
import { FaFilter, FaCalendar, FaCheck, FaClock, FaFire, FaSortAmountDown, FaSortAmountUp } from 'react-icons/fa';

interface FilterOption {
  id: string;
  label: string;
  icon: React.ReactNode;
  filterFn: (tasks: any[]) => any[];
}

interface SortOption {
  id: string;
  label: string;
  icon: React.ReactNode;
  sortFn: (a: any, b: any) => number;
}

interface TaskFilterProps {
  onFilterChange: (filter: string) => void;
  onSortChange: (sort: string) => void;
  onPriorityFilterChange?: (priority: number | null) => void;
  onEnergyFilterChange?: (min: number, max: number) => void;
  activeFilter: string;
  activeSort: string;
  activePriority?: number | null;
  activeEnergyRange?: { min: number; max: number };
  totalTasks: number;
  completedTasks: number;
}

export const TaskFilter: React.FC<TaskFilterProps> = ({
  onFilterChange,
  onSortChange,
  onPriorityFilterChange,
  onEnergyFilterChange,
  activeFilter,
  activeSort,
  activePriority,
  activeEnergyRange,
  totalTasks,
  completedTasks
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const filterOptions = [
    { id: 'all', label: 'All Tasks', icon: <FaFilter className="w-4 h-4" /> },
    { id: 'today', label: 'Today', icon: <FaCalendar className="w-4 h-4" /> },
    { id: 'pending', label: 'Pending', icon: <FaClock className="w-4 h-4" /> },
    { id: 'completed', label: 'Completed', icon: <FaCheck className="w-4 h-4" /> },
    { id: 'high_energy', label: 'High Energy', icon: <FaFire className="w-4 h-4" /> },
  ];

  const sortOptions = [
    { id: 'priority_asc', label: 'Priority (High to Low)', icon: <FaSortAmountDown className="w-4 h-4" /> },
    { id: 'priority_desc', label: 'Priority (Low to High)', icon: <FaSortAmountUp className="w-4 h-4" /> },
    { id: 'due_date', label: 'Due Date', icon: <FaCalendar className="w-4 h-4" /> },
    { id: 'energy', label: 'Energy Cost', icon: <FaFire className="w-4 h-4" /> },
    { id: 'created', label: 'Created Date', icon: <FaSortAmountDown className="w-4 h-4" /> },
  ];

  const priorityOptions = [
    { id: null, label: 'All Priorities', color: 'bg-gray-200 text-gray-800' },
    { id: 1, label: 'High', color: 'bg-red-100 text-red-800' },
    { id: 2, label: 'Medium', color: 'bg-yellow-100 text-yellow-800' },
    { id: 3, label: 'Low', color: 'bg-blue-100 text-blue-800' },
  ];

  const energyRanges = [
    { id: 'all', label: 'All', min: 1, max: 10 },
    { id: 'low', label: 'Low (1-3)', min: 1, max: 3 },
    { id: 'medium', label: 'Medium (4-7)', min: 4, max: 7 },
    { id: 'high', label: 'High (8-10)', min: 8, max: 10 },
  ];

  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return (
    <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
      {/* 顶部统计信息 */}
      <div className="flex flex-wrap items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Task Overview</h3>
          <div className="flex items-center space-x-4 mt-2">
            <div className="text-sm text-gray-600">
              <span className="font-medium">{totalTasks}</span> total tasks
            </div>
            <div className="text-sm text-green-600">
              <span className="font-medium">{completedTasks}</span> completed
            </div>
            <div className="text-sm text-blue-600">
              <span className="font-medium">{completionRate}%</span> completion rate
            </div>
          </div>
        </div>

        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-sm text-primary-600 hover:text-primary-700 flex items-center"
          type="button"
        >
          <FaFilter className="w-4 h-4 mr-1" />
          {showAdvanced ? 'Hide Advanced' : 'Show Advanced'}
        </button>
      </div>

      {/* 基础筛选器 */}
      <div className="mb-6">
        <div className="flex items-center mb-3">
          <FaFilter className="w-4 h-4 text-gray-500 mr-2" />
          <span className="text-sm font-medium text-gray-700">Quick Filters</span>
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
          {/* 优先级筛选 */}
          {onPriorityFilterChange && (
            <div>
              <div className="flex items-center mb-3">
                <span className="text-sm font-medium text-gray-700">Priority</span>
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
                <span className="text-sm font-medium text-gray-700">Energy Range</span>
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
              <span className="text-sm font-medium text-gray-700">Sort By</span>
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
          <span className="font-medium">Active filters:</span>{' '}
          {activeFilter !== 'all' && (
            <span className="inline-flex items-center px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs ml-2">
              {filterOptions.find(f => f.id === activeFilter)?.label}
            </span>
          )}
          {activePriority !== null && activePriority !== undefined && (
            <span className="inline-flex items-center px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs ml-2">
              {priorityOptions.find(p => p.id === activePriority)?.label}
            </span>
          )}
          {activeEnergyRange && activeEnergyRange.min !== 1 && activeEnergyRange.max !== 10 && (
            <span className="inline-flex items-center px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs ml-2">
              Energy: {activeEnergyRange.min}-{activeEnergyRange.max}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};