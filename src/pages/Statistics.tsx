// src/pages/Statistics.tsx
// 数据统计。视觉层级取舍：
// - 三个关键指标合成一张卡（分隔线分栏），比三张独立卡片更整体、占位更少；
// - 时间范围用分段控件，与任务页视图切换保持同一套交互语言；
// - 删除页面标题/副标题（页头已有）与重复的图例说明，让数字与图表自己说话。
import React, { useState, useEffect } from 'react';
import {
  FaChartBar,
  FaChartLine,
  FaChartPie,
  FaCalendarAlt,
  FaCheckCircle,
  FaList,
  FaSmile,
  FaFrown,
  FaMeh,
  FaArrowUp,
  FaArrowDown,
} from 'react-icons/fa';
import { api } from '../api';
import { Task, Mood } from '../types';
import { usePluginHost } from '../plugins/runtime';
import { recordsToMoods } from '../plugins/pages/moodData';

/** 今天 0 点往前推 days 天的毫秒时间戳（时间范围过滤用） */
function startOfDaysAgo(days: number): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.getTime();
}

/** 环比徽标：无变化时不显示箭头（避免 "↑ +0pp" 这种伪增长） */
const TrendBadge: React.FC<{ value: string }> = ({ value }) => {
  if (/^[+-]?0(%|pp)$/.test(value)) {
    return (
      <span className="text-[11px] text-ink-3" title="与上一周期持平">
        —
      </span>
    );
  }
  const negative = value.startsWith('-');
  return (
    <span
      className={`tnum inline-flex items-center gap-1 text-[11px] ${
        negative ? 'text-danger' : 'text-ok'
      }`}
    >
      {negative ? <FaArrowDown className="text-[9px]" /> : <FaArrowUp className="text-[9px]" />}
      {value}
    </span>
  );
};

const PRIORITY_META: Record<number, { label: string; bar: string; text: string }> = {
  1: { label: '高', bar: 'bg-danger', text: 'text-danger' },
  2: { label: '中', bar: 'bg-warn', text: 'text-warn' },
  3: { label: '低', bar: 'bg-ink-3/50', text: 'text-ink-3' },
};

export const Statistics: React.FC = () => {
  const [timeRange, setTimeRange] = useState<'week' | 'month' | 'year'>('month');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [moods, setMoods] = useState<Mood[]>([]);
  const [loading, setLoading] = useState(true);
  const { plugins, dataStore } = usePluginHost();

  const moodPluginEnabled = plugins.some((p) => p.id === 'mood-diary' && p.enabled);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const [tasksData] = await Promise.all([api.getTasks()]);
        setTasks(tasksData);

        let moodsData: Mood[] = [];
        if (moodPluginEnabled) {
          try {
            const records = await dataStore.list('core', 'mood', 'entries');
            moodsData = recordsToMoods(records);
          } catch (err) {
            console.warn('读取心情插件数据失败:', err);
          }
        }
        setMoods(moodsData);
      } catch (error) {
        console.error('加载统计数据失败:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [moodPluginEnabled, dataStore]);

  // ---- 时间范围过滤 ----
  const rangeDays = timeRange === 'week' ? 7 : timeRange === 'month' ? 30 : 365;
  const rangeLabel = timeRange === 'week' ? '上周期' : timeRange === 'month' ? '上期' : '同期';
  const rangeStart = startOfDaysAgo(rangeDays);
  const prevRangeStart = startOfDaysAgo(rangeDays * 2);

  const inRange = (
    value: string | undefined,
    from: number,
    to = Number.POSITIVE_INFINITY,
  ): boolean => {
    if (!value) return false;
    const ts = new Date(value).getTime();
    return Number.isFinite(ts) && ts >= from && ts < to;
  };

  const tasksInRange = tasks.filter((t) => inRange(t.created_at, rangeStart));
  const prevTasks = tasks.filter((t) => inRange(t.created_at, prevRangeStart, rangeStart));
  const moodsInRange = moods.filter((m) => inRange(m.date, rangeStart));
  const prevMoods = moods.filter((m) => inRange(m.date, prevRangeStart, rangeStart));

  const totalTasks = tasksInRange.length;
  const completedTasks = tasksInRange.filter((task) => task.status === 'completed').length;
  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const getMoodType = (score: number): 'happy' | 'neutral' | 'sad' => {
    if (score >= 4) return 'happy';
    if (score >= 3) return 'neutral';
    return 'sad';
  };

  const moodDistribution = moodsInRange.reduce(
    (acc, curr) => {
      const moodType = getMoodType(curr.mood_score);
      acc[moodType] = (acc[moodType] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const priorityDistribution = tasksInRange.reduce(
    (acc, curr) => {
      acc[curr.priority] = (acc[curr.priority] || 0) + 1;
      return acc;
    },
    {} as Record<number, number>,
  );

  const dailyCompletion = tasksInRange.reduce(
    (acc, task) => {
      const date = task.created_at.split('T')[0];
      if (!acc[date]) acc[date] = { total: 0, completed: 0 };
      acc[date].total += 1;
      if (task.status === 'completed') acc[date].completed += 1;
      return acc;
    },
    {} as Record<string, { total: number; completed: number }>,
  );

  const getMoodIcon = (mood: string) => {
    switch (mood) {
      case 'happy':
        return <FaSmile className="text-ok" />;
      case 'neutral':
        return <FaMeh className="text-warn" />;
      case 'sad':
        return <FaFrown className="text-danger" />;
      default:
        return <FaSmile className="text-ink-3" />;
    }
  };

  const getMoodLabel = (mood: string) => {
    switch (mood) {
      case 'happy':
        return '开心';
      case 'neutral':
        return '一般';
      case 'sad':
        return '难过';
      default:
        return mood;
    }
  };

  // 趋势：与上一个等长周期真实对比
  const percentChange = (current: number, previous: number): string => {
    if (previous === 0) return current === 0 ? '0%' : `+${current}`;
    const delta = Math.round(((current - previous) / previous) * 100);
    return `${delta >= 0 ? '+' : ''}${delta}%`;
  };
  const prevCompletionRate =
    prevTasks.length > 0
      ? Math.round(
          (prevTasks.filter((t) => t.status === 'completed').length / prevTasks.length) * 100,
        )
      : 0;
  const completionDelta = completionRate - prevCompletionRate;

  const trend = {
    tasksChange: percentChange(tasksInRange.length, prevTasks.length),
    completionChange: `${completionDelta >= 0 ? '+' : ''}${completionDelta}pp`,
    moodsChange: percentChange(moodsInRange.length, prevMoods.length),
  };

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
    return bestDay
      ? {
          date: bestDay,
          completed: dailyCompletion[bestDay]?.completed || 0,
          rate: Math.round(maxCompletion),
        }
      : null;
  };

  if (loading) {
    return <div className="flex h-48 items-center justify-center text-sm text-ink-3">载入中…</div>;
  }

  const mostEfficientDay = getMostEfficientDay();
  const topMood = Object.entries(moodDistribution).sort((a, b) => b[1] - a[1])[0];

  const metrics = [
    {
      key: 'tasks',
      label: '总任务数',
      value: totalTasks,
      icon: <FaList />,
      trend: trend.tasksChange,
    },
    {
      key: 'rate',
      label: '完成率',
      value: `${completionRate}%`,
      icon: <FaCheckCircle />,
      trend: trend.completionChange,
    },
    {
      key: 'moods',
      label: '心情记录',
      value: moodsInRange.length,
      icon: <FaChartPie />,
      trend: trend.moodsChange,
    },
  ];

  return (
    <div className="space-y-4">
      {/* 时间范围 */}
      <div className="flex items-center justify-between gap-3">
        <div className="seg" role="tablist" aria-label="时间范围">
          {(
            [
              { id: 'week', label: '本周' },
              { id: 'month', label: '本月' },
              { id: 'year', label: '今年' },
            ] as const
          ).map((r) => (
            <button
              key={r.id}
              type="button"
              role="tab"
              aria-selected={timeRange === r.id}
              data-active={timeRange === r.id}
              onClick={() => setTimeRange(r.id)}
              className="seg-item"
            >
              {r.label}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-ink-3">环比{rangeLabel}</span>
      </div>

      {/* 关键指标：一张卡分栏，视觉更整体 */}
      <div className="card grid grid-cols-1 divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {metrics.map((m) => (
          <div key={m.key} className="flex flex-col gap-1.5 p-5">
            <div className="flex items-center gap-1.5 text-ink-3">
              <span className="text-[11px]">{m.icon}</span>
              <span className="text-[11px] font-medium tracking-wide">{m.label}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="tnum text-2xl leading-none font-semibold text-ink">{m.value}</span>
              <TrendBadge value={m.trend} />
            </div>
          </div>
        ))}
      </div>

      {!moodPluginEnabled && (
        <p className="text-[11px] text-ink-3">心情数据由「心情日记」插件提供，当前未启用。</p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 心情分布 */}
        <section className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">心情分布</h2>
            <FaChartPie className="text-[13px] text-ink-3" />
          </div>

          {moodsInRange.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-3">暂无数据</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(moodDistribution).map(([mood, count]) => (
                <div key={mood} className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface text-[13px]">
                    {getMoodIcon(mood)}
                  </span>
                  <span className="flex-1 text-[13px] font-medium text-ink">
                    {getMoodLabel(mood)}
                  </span>
                  <span className="tnum text-[11px] text-ink-3">{count} 次</span>
                  <span className="tnum w-10 text-right text-[13px] font-semibold text-ink">
                    {Math.round((count / moodsInRange.length) * 100)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 优先级分布 */}
        <section className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">优先级分布</h2>
            <FaChartBar className="text-[13px] text-ink-3" />
          </div>

          {totalTasks === 0 ? (
            <p className="py-8 text-center text-sm text-ink-3">暂无数据</p>
          ) : (
            <div className="space-y-3.5">
              {Object.entries(priorityDistribution)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([priority, count]) => {
                  const p = Number(priority);
                  const meta = PRIORITY_META[p] ?? { label: '其他', bar: 'bg-ink-3/50', text: 'text-ink-3' };
                  return (
                    <div key={priority}>
                      <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
                        <span className="text-ink-2">{meta.label}优先级</span>
                        <span className="tnum text-ink">
                          {count}
                          <span className="ml-1 text-[11px] text-ink-3">
                            {Math.round((count / totalTasks) * 100)}%
                          </span>
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                        <div
                          className={`h-full rounded-full ${meta.bar}`}
                          style={{ width: `${(count / totalTasks) * 100}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </section>

        {/* 每日完成情况 */}
        <section className="card overflow-hidden lg:col-span-2">
          <div className="flex items-center justify-between px-5 py-3.5">
            <h2 className="text-sm font-semibold text-ink">每日完成情况</h2>
            <FaChartLine className="text-[13px] text-ink-3" />
          </div>

          {Object.keys(dailyCompletion).length === 0 ? (
            <p className="px-5 pb-8 text-center text-sm text-ink-3">暂无数据</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-y border-line text-left text-[11px] text-ink-3">
                    <th className="px-5 py-2 font-medium">日期</th>
                    <th className="px-3 py-2 font-medium">总任务</th>
                    <th className="px-3 py-2 font-medium">已完成</th>
                    <th className="px-5 py-2 font-medium">完成率</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(dailyCompletion)
                    .sort(([a], [b]) => new Date(b).getTime() - new Date(a).getTime())
                    .slice(0, 10)
                    .map(([date, stats]) => {
                      const rate = Math.round((stats.completed / stats.total) * 100);
                      return (
                        <tr
                          key={date}
                          className="border-b border-line transition-colors last:border-0 hover:bg-surface-2"
                        >
                          <td className="tnum px-5 py-2.5 text-ink-2">{date}</td>
                          <td className="tnum px-3 py-2.5 text-ink-2">{stats.total}</td>
                          <td className="tnum px-3 py-2.5 text-ink-2">{stats.completed}</td>
                          <td className="px-5 py-2.5">
                            <div className="flex items-center gap-2.5">
                              <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-3">
                                <div
                                  className="h-full rounded-full bg-ok"
                                  style={{ width: `${rate}%` }}
                                />
                              </div>
                              <span className="tnum text-ink">{rate}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* 小结 */}
      <section className="card grid grid-cols-1 gap-4 p-5 sm:grid-cols-3">
        <div>
          <div className="mb-1 text-[11px] text-ink-3">最高效的一天</div>
          {mostEfficientDay ? (
            <>
              <div className="tnum flex items-center gap-2 text-[15px] font-semibold text-ink">
                <FaCalendarAlt className="text-[11px] text-ink-3" />
                {mostEfficientDay.date}
              </div>
              <div className="tnum text-[11px] text-ink-3">
                完成 {mostEfficientDay.completed} 项 · {mostEfficientDay.rate}%
              </div>
            </>
          ) : (
            <div className="text-[13px] text-ink-3">暂无数据</div>
          )}
        </div>
        <div>
          <div className="mb-1 text-[11px] text-ink-3">最常见心情</div>
          <div className="text-[15px] font-semibold text-ink">
            {topMood ? getMoodLabel(topMood[0]) : '暂无数据'}
          </div>
          {topMood && <div className="tnum text-[11px] text-ink-3">记录 {topMood[1]} 次</div>}
        </div>
        <div>
          <div className="mb-1 text-[11px] text-ink-3">累计完成</div>
          <div className="tnum text-[15px] font-semibold text-ink">{completedTasks} 项</div>
          <div className="tnum text-[11px] text-ink-3">完成率 {completionRate}%</div>
        </div>
      </section>
    </div>
  );
};
