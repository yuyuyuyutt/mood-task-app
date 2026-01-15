//src/pages/MoodDiary.tsx
import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { MoodEntryForm } from '../components/mood/MoodEntryForm';
import { MoodCalendar } from '../components/mood/MoodCalendar';
import { api } from '../api';
import { Mood } from '../types';
import { FaSmile, FaCalendarAlt } from 'react-icons/fa';

export const MoodDiary: React.FC = () => {
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [moodEntries, setMoodEntries] = useState<Mood[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    loadMoodEntries();
  }, []);

  const loadMoodEntries = async () => {
    setLoading(true);
    try {
      const data = await api.getMoods();
      setMoodEntries(data);
    } catch (error) {
      console.error('Failed to load mood entries:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (moodData: Omit<Mood, 'id' | 'created_at'>) => {
    try {
      await api.saveMood(moodData);
      await loadMoodEntries();
      setShowForm(false);
    } catch (error) {
      console.error('Failed to save mood entry:', error);
      alert('Failed to save mood entry. Please try again.');
    }
  };

  const getSelectedEntry = () => {
    return moodEntries.find(entry => entry.date === selectedDate);
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">Loading mood entries...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-4">
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
          {/* 心情表单 */}
          {showForm ? (
            <MoodEntryForm
              date={selectedDate}
              existingEntry={getSelectedEntry()}
              onSubmit={handleSubmit}
              onCancel={() => setShowForm(false)}
            />
          ) : (
            <div className="bg-white rounded-xl shadow-sm p-6">
              <div className="text-center py-12">
                <div className="text-4xl mb-4">📝</div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  未选择记录
                </h3>
                <p className="text-gray-600 mb-6">
                  在日历中选择日期以查看或创建心情记录
                </p>
                <button
                  onClick={() => setShowForm(true)}
                  className="btn btn-primary"
                >
                  创建新记录
                </button>
              </div>
            </div>
          )}

          {/* 近期记录 */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-gray-900">
                近期记录
              </h3>
              <FaCalendarAlt className="w-5 h-5 text-gray-500" />
            </div>
            
            {moodEntries.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                还没有心情记录，开始记录吧！
              </div>
            ) : (
              <div className="space-y-4">
                {moodEntries
                  .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                  .slice(0, 5)
                  .map(entry => (
                    <div
                      key={entry.id}
                      className={`p-4 rounded-lg border cursor-pointer transition-all hover:shadow-md ${
                        entry.date === selectedDate ? 'border-primary-500 bg-primary-50' : 'border-gray-200'
                      }`}
                      onClick={() => {
                        setSelectedDate(entry.date);
                        setShowForm(true);
                      }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center">
                          <span className="text-2xl mr-3">{entry.mood_emoji}</span>
                          <span className="font-medium text-gray-900">
                            {format(new Date(entry.date), 'MM月d日')}
                          </span>
                        </div>
                        <span className="text-sm text-gray-500">
                          {entry.mood_score}/5
                        </span>
                      </div>
                      <p className="text-gray-700 text-sm line-clamp-2">
                        {entry.content}
                      </p>
                      {entry.tags && entry.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-3">
                          {entry.tags.slice(0, 3).map(tag => (
                            <span
                              key={tag}
                              className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded"
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
            
            {moodEntries.length > 5 && (
              <button
                onClick={() => {
                  alert('查看所有记录 - 待实现');
                }}
                className="w-full mt-4 py-2 text-sm text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded-lg"
              >
                查看所有记录 →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};