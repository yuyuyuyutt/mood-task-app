// src/plugins/pages/MoodDiaryPage.tsx
// 心情日记页面的渲染器（由插件宿主在 pageId="mood-diary" 时挂载）。
// 原主应用中的 MoodDiary 页面迁移至此；数据不再直接调用核心 API，
// 而是通过插件数据能力（namespace="mood"）读写长期数据。
// 卸载/禁用该插件后，此页面随之从路由与导航中移除。
import React, { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { MoodEntryForm } from '../../components/mood/MoodEntryForm';
import { MoodCalendar } from '../../components/mood/MoodCalendar';
import { usePluginData } from '../runtime/context';
import { loadMoodEntries, saveMoodEntry } from './moodData';
import type { Mood } from '../../types';
import { FaSmile, FaCalendarAlt, FaExclamationTriangle } from 'react-icons/fa';

export const MoodDiaryPage: React.FC = () => {
  const access = usePluginData('mood-diary');
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [moodEntries, setMoodEntries] = useState<Mood[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await loadMoodEntries(access);
      setMoodEntries(data);
      setError(null);
    } catch (err) {
      console.error('加载心情记录失败:', err);
      setError('心情数据暂时不可用（插件数据能力未生效）');
    } finally {
      setLoading(false);
    }
  }, [access]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSubmit = async (moodData: Omit<Mood, 'id' | 'created_at'>) => {
    try {
      await saveMoodEntry(access, moodData);
      await load();
      setShowForm(false);
    } catch (err) {
      console.error('保存心情记录失败:', err);
      alert('保存失败，请重试');
    }
  };

  const getSelectedEntry = () => moodEntries.find((entry) => entry.date === selectedDate);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500 dark:text-gray-400">Loading mood entries...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-4">
      {error && (
        <div className="mb-6 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 flex items-center">
          <FaExclamationTriangle className="w-5 h-5 text-yellow-500 mr-3 flex-shrink-0" />
          <p className="text-yellow-700 dark:text-yellow-400">{error}</p>
        </div>
      )}

      {/* 头部 */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center space-x-3">
          <button
            onClick={() => {
              setSelectedDate(format(new Date(), 'yyyy-MM-dd'));
              setShowForm(true);
            }}
            className="btn btn-primary flex items-center"
          >
            <FaSmile className="w-5 h-5 mr-2" />
            记录今日心情
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* 左侧：心情日历 */}
        <div className="lg:col-span-2">
          <MoodCalendar
            entries={moodEntries}
            selectedDate={selectedDate}
            onDateSelect={(date) => {
              setSelectedDate(date);
              setShowForm(true);
            }}
          />
        </div>

        {/* 右侧：心情表单和历史记录 */}
        <div className="space-y-8">
          {showForm ? (
            <MoodEntryForm
              date={selectedDate}
              existingEntry={getSelectedEntry()}
              onSubmit={handleSubmit}
              onCancel={() => setShowForm(false)}
            />
          ) : (
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm p-6">
              <div className="text-center py-12">
                <div className="text-4xl mb-4">📝</div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  未选择记录
                </h3>
                <p className="text-gray-600 dark:text-gray-400 mb-6">
                  在日历中选择日期以查看或创建心情记录
                </p>
                <button onClick={() => setShowForm(true)} className="btn btn-primary">
                  创建新记录
                </button>
              </div>
            </div>
          )}

          {/* 近期记录 */}
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                近期记录
              </h3>
              <FaCalendarAlt className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            </div>

            {moodEntries.length === 0 ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                还没有心情记录，开始记录吧！
              </div>
            ) : (
              <div className="space-y-4">
                {moodEntries.slice(0, 5).map((entry) => (
                  <div
                    key={entry.date}
                    className={`p-4 rounded-lg border cursor-pointer transition-all hover:shadow-md dark:hover:bg-gray-800 ${
                      entry.date === selectedDate
                        ? 'border-primary-500 bg-primary-50 dark:bg-blue-900/30 dark:border-blue-500'
                        : 'border-gray-200 dark:border-gray-700'
                    }`}
                    onClick={() => {
                      setSelectedDate(entry.date);
                      setShowForm(true);
                    }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center">
                        <span className="text-2xl mr-3">{entry.mood_emoji}</span>
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          {format(new Date(entry.date), 'MM月d日')}
                        </span>
                      </div>
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {entry.mood_score}/5
                      </span>
                    </div>
                    <p className="text-gray-700 dark:text-gray-300 text-sm line-clamp-2">
                      {entry.content}
                    </p>
                    {entry.tags && entry.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-3">
                        {entry.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
