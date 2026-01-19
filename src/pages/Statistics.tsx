//src/pages/Statistics.tsx
import React, { useState, useEffect } from 'react';
import { 
  FaChartBar, 
  FaChartLine, 
  FaChartPie, 
  FaCalendarAlt,
  FaCheckCircle,
  FaBolt,
  FaList,
  FaSmile,
  FaFrown,
  FaMeh,
  FaArrowUp,
  FaArrowDown
} from 'react-icons/fa';
import { api } from '../api';
import { Task, Mood } from '../types';

export const Statistics: React.FC = () => {
  const [timeRange, setTimeRange] = useState<'week' | 'month' | 'year'>('month');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [moods, setMoods] = useState<Mood[]>([]);
  const [setStatistics] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // 从数据库加载数据
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        // 并行加载所有数据
        const [tasksData, moodsData, statsData] = await Promise.all([
          api.getTasks(),
          api.getMoods(),
          api.getStatistics()
        ]);

        setTasks(tasksData);
        setMoods(moodsData);
        setStatistics(statsData);
      } catch (error) {
        console.error('加载统计数据失败:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [timeRange]);

  // 计算统计信息
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(task => task.status === 'completed').length;
  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  
  // 计算平均能量消耗
  const avgEnergy = tasks.length > 0 
    ? Math.round(tasks.reduce((sum, task) => sum + (task.energy_cost || 0), 0) / tasks.length) 
    : 0;
  
  // 根据mood_score转换心情类型
  const getMoodType = (score: number): 'happy' | 'neutral' | 'sad' => {
    if (score >= 4) return 'happy';
    if (score >= 3) return 'neutral';
    return 'sad';
  };

  // 心情分布
  const moodDistribution = moods.reduce((acc, curr) => {
    const moodType = getMoodType(curr.mood_score);
    acc[moodType] = (acc[moodType] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // 优先级分布
  const priorityDistribution = tasks.reduce((acc, curr) => {
    acc[curr.priority] = (acc[curr.priority] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);

  // 任务完成趋势（按日期）
  const dailyCompletion = tasks.reduce((acc, task) => {
    // 使用created_at的日期部分
    const date = task.created_at.split('T')[0];
    if (!acc[date]) {
      acc[date] = { total: 0, completed: 0 };
    }
    acc[date].total += 1;
    if (task.status === 'completed') acc[date].completed += 1;
    return acc;
  }, {} as Record<string, { total: number; completed: number }>);

  // 获取心情图标
  const getMoodIcon = (mood: string) => {
    switch (mood) {
      case 'happy': return <FaSmile className="text-green-500" />;
      case 'neutral': return <FaMeh className="text-yellow-500" />;
      case 'sad': return <FaFrown className="text-red-500" />;
      default: return <FaSmile className="text-gray-500" />;
    }
  };

  // 获取心情标签
  const getMoodLabel = (mood: string) => {
    switch (mood) {
      case 'happy': return '开心';
      case 'neutral': return '一般';
      case 'sad': return '难过';
      default: return mood;
    }
  };

  // 获取优先级标签
  const getPriorityLabel = (priority: number) => {
    switch (priority) {
      case 1: return '高';
      case 2: return '中';
      case 3: return '低';
      default: return `优先级 ${priority}`;
    }
  };

  // 计算趋势变化
  const calculateTrend = () => {
    // 这里可以添加更复杂的趋势计算逻辑
    // 暂时返回固定值
    return {
      tasksChange: '+12%',
      completionChange: '+8%',
      energyChange: '-3%',
      moodsChange: '+5%'
    };
  };

  const trend = calculateTrend();

  // 找到最高效的一天（完成率最高）
  const getMostEfficientDay = () => {
    let maxCompletion = 0;
    let bestDay = '';

    Object.entries(dailyCompletion).forEach(([date, stats]) => {
      const rate = stats.total > 0 ? (stats.completed / stats.total) * 100 : 0;
      if (rate > maxCompletion) {
        maxCompletion = rate;
        bestDay = date;
      }
    });

    return bestDay ? {
      date: bestDay,
      completed: dailyCompletion[bestDay]?.completed || 0,
      rate: Math.round(maxCompletion)
    } : null;
  };

  // 找到能量消耗最高的任务
  const getHighestEnergyTask = () => {
    if (tasks.length === 0) return null;
    
    const highestTask = tasks.reduce((max, task) => {
      return (task.energy_cost || 0) > (max.energy_cost || 0) ? task : max;
    });
    
    return highestTask;
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-gray-500">加载统计数据中...</div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* 头部 */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">数据统计</h1>
          <p className="text-gray-600 mt-2">
            查看您的任务完成情况和心情趋势
          </p>
        </div>
        <div className="flex space-x-2 mt-4 md:mt-0">
          <button
            onClick={() => setTimeRange('week')}
            className={`px-4 py-2 rounded-lg ${timeRange === 'week' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
          >
            本周
          </button>
          <button
            onClick={() => setTimeRange('month')}
            className={`px-4 py-2 rounded-lg ${timeRange === 'month' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
          >
            本月
          </button>
          <button
            onClick={() => setTimeRange('year')}
            className={`px-4 py-2 rounded-lg ${timeRange === 'year' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
          >
            今年
          </button>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-600">总任务数</div>
              <div className="text-3xl font-bold text-gray-900 mt-2">{totalTasks}</div>
            </div>
            <div className="p-3 bg-blue-50 rounded-lg">
              <FaList className="w-6 h-6 text-blue-600" />
            </div>
          </div>
          <div className="mt-4">
            <div className="flex items-center text-sm">
              <FaArrowUp className="w-4 h-4 text-green-500 mr-1" />
              <span className="text-green-500">{trend.tasksChange}</span>
              <span className="text-gray-500 ml-2">相比上周</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-600">完成率</div>
              <div className="text-3xl font-bold text-gray-900 mt-2">{completionRate}%</div>
            </div>
            <div className="p-3 bg-green-50 rounded-lg">
              <FaCheckCircle className="w-6 h-6 text-green-600" />
            </div>
          </div>
          <div className="mt-4">
            <div className="flex items-center text-sm">
              <FaArrowUp className="w-4 h-4 text-green-500 mr-1" />
              <span className="text-green-500">{trend.completionChange}</span>
              <span className="text-gray-500 ml-2">相比上周</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-600">平均能量消耗</div>
              <div className="text-3xl font-bold text-gray-900 mt-2">{avgEnergy} ⚡</div>
            </div>
            <div className="p-3 bg-yellow-50 rounded-lg">
              <FaBolt className="w-6 h-6 text-yellow-600" />
            </div>
          </div>
          <div className="mt-4">
            <div className="flex items-center text-sm">
              <FaArrowDown className="w-4 h-4 text-red-500 mr-1" />
              <span className="text-red-500">{trend.energyChange}</span>
              <span className="text-gray-500 ml-2">相比上周</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-600">心情记录</div>
              <div className="text-3xl font-bold text-gray-900 mt-2">{moods.length}</div>
            </div>
            <div className="p-3 bg-purple-50 rounded-lg">
              <FaChartPie className="w-6 h-6 text-purple-600" />
            </div>
          </div>
          <div className="mt-4">
            <div className="flex items-center text-sm">
              <FaArrowUp className="w-4 h-4 text-green-500 mr-1" />
              <span className="text-green-500">{trend.moodsChange}</span>
              <span className="text-gray-500 ml-2">相比上周</span>
            </div>
          </div>
        </div>
      </div>

      {/* 图表和数据 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* 心情分布 */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900">心情分布</h2>
            <FaChartPie className="w-5 h-5 text-gray-400" />
          </div>
          
          <div className="space-y-4">
            {Object.entries(moodDistribution).map(([mood, count]) => (
              <div key={mood} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center">
                  <div className="w-10 h-10 flex items-center justify-center bg-white rounded-lg mr-3">
                    {getMoodIcon(mood)}
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">{getMoodLabel(mood)}</div>
                    <div className="text-sm text-gray-500">{count} 次记录</div>
                  </div>
                </div>
                <div className="text-lg font-semibold text-gray-900">
                  {Math.round((count / moods.length) * 100)}%
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 pt-6 border-t border-gray-200">
            <div className="flex items-center text-sm text-gray-500">
              <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
              <span>开心: {getMoodLabel('happy')}</span>
              <div className="w-2 h-2 bg-yellow-500 rounded-full mx-4 ml-6"></div>
              <span>一般: {getMoodLabel('neutral')}</span>
              <div className="w-2 h-2 bg-red-500 rounded-full mx-4 ml-6"></div>
              <span>难过: {getMoodLabel('sad')}</span>
            </div>
          </div>
        </div>

        {/* 任务优先级分布 */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900">任务优先级分布</h2>
            <FaChartBar className="w-5 h-5 text-gray-400" />
          </div>

          <div className="space-y-4">
            {Object.entries(priorityDistribution)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([priority, count]) => {
                const priorityNum = Number(priority);
                let bgColor = 'bg-gray-200';
                let textColor = 'text-gray-600';
                
                if (priorityNum === 1) {
                  bgColor = 'bg-red-100';
                  textColor = 'text-red-600';
                } else if (priorityNum === 2) {
                  bgColor = 'bg-yellow-100';
                  textColor = 'text-yellow-600';
                } else if (priorityNum === 3) {
                  bgColor = 'bg-green-100';
                  textColor = 'text-green-600';
                }

                return (
                  <div key={priority} className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium text-gray-700">
                        {getPriorityLabel(priorityNum)}优先级
                      </span>
                      <span className="text-gray-900">{count} 个任务</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className={`h-2 rounded-full ${bgColor} ${textColor}`}
                        style={{ width: `${(count / totalTasks) * 100}%` }}
                      ></div>
                    </div>
                  </div>
                );
              })}
          </div>

          <div className="mt-8 grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">
                {priorityDistribution[1] || 0}
              </div>
              <div className="text-sm text-gray-500">高优先级</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-yellow-600">
                {priorityDistribution[2] || 0}
              </div>
              <div className="text-sm text-gray-500">中优先级</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {priorityDistribution[3] || 0}
              </div>
              <div className="text-sm text-gray-500">低优先级</div>
            </div>
          </div>
        </div>

        {/* 每日完成情况 */}
        <div className="bg-white rounded-xl shadow-sm p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900">每日任务完成情况</h2>
            <FaChartLine className="w-5 h-5 text-gray-400" />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-sm text-gray-500 border-b border-gray-200">
                  <th className="pb-3">日期</th>
                  <th className="pb-3">总任务</th>
                  <th className="pb-3">已完成</th>
                  <th className="pb-3">完成率</th>
                  <th className="pb-3">平均能量</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(dailyCompletion)
                  .sort(([a], [b]) => new Date(b).getTime() - new Date(a).getTime())
                  .slice(0, 10) // 只显示最近10天
                  .map(([date, stats]) => {
                    const dayTasks = tasks.filter(t => t.created_at.startsWith(date));
                    const dayEnergy = dayTasks.length > 0 
                      ? Math.round(dayTasks.reduce((sum, t) => sum + (t.energy_cost || 0), 0) / dayTasks.length)
                      : 0;
                    
                    return (
                      <tr key={date} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-4">
                          <div className="flex items-center">
                            <FaCalendarAlt className="w-4 h-4 text-gray-400 mr-2" />
                            <span className="font-medium">{date}</span>
                          </div>
                        </td>
                        <td className="py-4">
                          <span className="px-3 py-1 bg-gray-100 rounded-full text-sm">
                            {stats.total}
                          </span>
                        </td>
                        <td className="py-4">
                          <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm">
                            {stats.completed}
                          </span>
                        </td>
                        <td className="py-4">
                          <div className="flex items-center">
                            <div className="w-24 bg-gray-200 rounded-full h-2 mr-3">
                              <div 
                                className="h-2 bg-green-500 rounded-full"
                                style={{ width: `${(stats.completed / stats.total) * 100}%` }}
                              ></div>
                            </div>
                            <span className="font-medium">
                              {Math.round((stats.completed / stats.total) * 100)}%
                            </span>
                          </div>
                        </td>
                        <td className="py-4">
                          <div className="flex items-center">
                            <FaBolt className="w-4 h-4 text-yellow-500 mr-2" />
                            <span className="font-medium">{dayEnergy} ⚡</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 总结 */}
      <div className="mt-8 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl shadow-sm p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">📊 月度总结</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <div className="text-sm text-gray-600 mb-1">最高效的一天</div>
            {getMostEfficientDay() ? (
              <>
                <div className="text-lg font-bold text-gray-900">{getMostEfficientDay()?.date}</div>
                <div className="text-sm text-gray-500">完成了 {getMostEfficientDay()?.completed} 个任务</div>
              </>
            ) : (
              <div className="text-gray-500">暂无数据</div>
            )}
          </div>
          <div>
            <div className="text-sm text-gray-600 mb-1">最常见的心情</div>
            <div className="text-lg font-bold text-gray-900">
              {Object.keys(moodDistribution).length > 0 
                ? getMoodLabel(Object.entries(moodDistribution).sort((a, b) => b[1] - a[1])[0][0])
                : '暂无数据'}
            </div>
            <div className="text-sm text-gray-500">
              {Object.keys(moodDistribution).length > 0 
                ? `记录 ${Object.entries(moodDistribution).sort((a, b) => b[1] - a[1])[0][1]} 次`
                : ''}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-600 mb-1">能量最高任务</div>
            {getHighestEnergyTask() ? (
              <>
                <div className="text-lg font-bold text-gray-900">{getHighestEnergyTask()?.title}</div>
                <div className="text-sm text-gray-500">消耗 {getHighestEnergyTask()?.energy_cost || 0} ⚡ 能量</div>
              </>
            ) : (
              <div className="text-gray-500">暂无数据</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};