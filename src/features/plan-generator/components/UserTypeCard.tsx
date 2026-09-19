// src/features/plan-generator/components/UserTypeCard.tsx
// 个人画像卡片（放置于系统设置页）：
// - 展示推断的用户类型 + 关键特征；
// - 允许手动修正类型（写回 IndexedDB，重新分析不会覆盖）；
// - "重新分析"基于最近 30 天任务（本地完成）。
import React, { useCallback, useEffect, useState } from 'react';
import {
  FaUserTag,
  FaSpinner,
  FaRedo,
  FaHourglassHalf,
  FaChartLine,
  FaCalendarCheck,
  FaRegClock,
  FaTasks,
  FaTag,
  FaUndo,
} from 'react-icons/fa';
import { api } from '../../../api';
import { tasksToSamples } from '../services/adapters';
import { USER_TYPE_META } from '../services/templates';
import { useHabitProfile } from '../hooks/useHabitProfile';
import type { UserType } from '../types';

const USER_TYPES: UserType[] = [
  'morning_person',
  'night_owl',
  'fragmented',
  'long_focus',
  'weekend_worker',
  'regular',
  'balanced',
];

export const UserTypeCard: React.FC = () => {
  const { profile, effectiveUserType, loading, analyze, setOverride, clearOverride } = useHabitProfile();
  const [analyzing, setAnalyzing] = useState(false);
  const [hasOverride, setHasOverride] = useState(false);
  const [taskCount, setTaskCount] = useState(0);

  useEffect(() => {
    setHasOverride(!!profile?.userTypeOverride);
  }, [profile]);

  const runAnalysis = useCallback(async () => {
    setAnalyzing(true);
    try {
      const tasks = await api.getTasks();
      setTaskCount(tasks.length);
      await analyze(tasksToSamples(tasks), []);
    } catch (err) {
      console.warn('习惯分析失败:', err);
    } finally {
      setAnalyzing(false);
    }
  }, [analyze]);

  // 首次进入且已有画像为空时自动分析
  useEffect(() => {
    if (!loading && !profile) void runAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const f = profile?.features;
  const meta = effectiveUserType ? USER_TYPE_META[effectiveUserType] : null;
  const inferredMeta = profile ? USER_TYPE_META[profile.userType] : null;

  const fmtPct = (v: number | undefined | null): string =>
    v == null ? '—' : `${Math.round(v * 100)}%`;

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center">
          <div className="p-2 rounded-lg bg-violet-50 mr-3">
            <FaUserTag className="w-5 h-5 text-violet-600" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900">个人画像（个性化计划）</h2>
          </div>
        </div>
        <button
          onClick={() => void runAnalysis()}
          disabled={analyzing}
          className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors disabled:opacity-60"
        >
          {analyzing ? <FaSpinner className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <FaRedo className="w-3.5 h-3.5 mr-1.5" />}
          重新分析
        </button>
      </div>

      {loading || analyzing ? (
        <div className="flex flex-col items-center py-8 text-gray-400">
          <FaSpinner className="w-6 h-6 animate-spin mb-2" />
          <span className="text-sm">正在本地分析最近任务…</span>
        </div>
      ) : !meta ? (
        <p className="text-sm text-gray-400 py-6 text-center">暂无足够数据，去任务页完成几个任务后再来分析吧。</p>
      ) : (
        <>
          {/* 当前类型 */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-5 p-4 rounded-xl border" style={{ borderColor: meta.color + '40', backgroundColor: meta.color + '0d' }}>
            <div className="flex items-center">
              <span className="w-2.5 h-2.5 rounded-full mr-2.5" style={{ backgroundColor: meta.color }} />
              <div>
                <p className="font-semibold text-gray-900">{meta.label}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md">{meta.description}</p>
              </div>
            </div>
            {hasOverride && (
              <span className="inline-flex items-center text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-600 whitespace-nowrap">
                已手动修正
                {inferredMeta && <span className="ml-1 text-gray-400">（推断：{inferredMeta.label}）</span>}
              </span>
            )}
          </div>

          {/* 关键特征 */}
          {f && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5 text-sm">
              <Feature icon={<FaChartLine className="w-3.5 h-3.5 text-emerald-500" />} label="任务完成率" value={fmtPct(f.completionRate)} sub={`${f.completedTasks}/${f.totalTasks}`} />
              <Feature icon={<FaHourglassHalf className="w-3.5 h-3.5 text-amber-500" />} label="平均任务耗时" value={f.avgTaskDurationMinutes != null ? `${f.avgTaskDurationMinutes} 分钟` : '—'} sub={`样本 ${f.durationSamples}`} />
              <Feature icon={<FaRegClock className="w-3.5 h-3.5 text-sky-500" />} label="高效完成时段" value={f.peakCompletionHour != null ? `${String(f.peakCompletionHour).padStart(2, '0')}:00 前后` : '—'} sub={`6-10点 ${fmtPct(f.morningRatio)} · 20-24点 ${fmtPct(f.eveningRatio)}`} />
              <Feature icon={<FaCalendarCheck className="w-3.5 h-3.5 text-blue-500" />} label="周末活跃度" value={f.weekendVsWeekdayRatio != null ? `${f.weekendVsWeekdayRatio.toFixed(2)}×` : '—'} sub="周末/工作日 每日常量比" />
              <Feature icon={<FaTasks className="w-3.5 h-3.5 text-indigo-500" />} label="时段分散度" value={`${f.taskSpreadHours} 个时段`} sub={f.eventSpreadHours > 0 ? `事件覆盖 ${f.eventSpreadHours} 个时段` : '暂无事件数据'} />
              <Feature icon={<FaTag className="w-3.5 h-3.5 text-rose-500" />} label="活跃天数 / 分布" value={`${f.activeDays} 天`} sub={Object.entries(f.taskTypeDistribution).slice(0, 3).map(([k, v]) => `${k}${v}`).join(' · ')} />
            </div>
          )}

          {/* 手动修正 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">手动修正类型（可选）</label>
            <div className="flex flex-wrap gap-1.5">
              {USER_TYPES.map((t) => {
                const m = USER_TYPE_META[t];
                const active = effectiveUserType === t;
                return (
                  <button
                    key={t}
                    onClick={() => void setOverride(t)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      active ? 'text-white border-transparent shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                    }`}
                    style={active ? { backgroundColor: m.color } : undefined}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
            {hasOverride && (
              <button
                onClick={() => void clearOverride()}
                className="mt-2 inline-flex items-center text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                <FaUndo className="w-3 h-3 mr-1" />
                恢复为推断结果（{inferredMeta?.label ?? '—'}）
              </button>
            )}
            <p className="mt-3 text-xs text-gray-400">
              使用最近 {profile?.dataWindowDays ?? 30} 天的数据（{taskCount} 项任务）；类型会影响"个性化计划生成器"的任务时段安排。
            </p>
          </div>
        </>
      )}
    </div>
  );
};

function Feature(props: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3">
      <div className="flex items-center text-gray-400 mb-1">{props.icon}<span className="ml-1.5 text-xs">{props.label}</span></div>
      <div className="font-semibold text-gray-900 text-sm">{props.value}</div>
      {props.sub && <div className="text-[11px] text-gray-400 mt-0.5 truncate">{props.sub}</div>}
    </div>
  );
}

