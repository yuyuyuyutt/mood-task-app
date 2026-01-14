//src/components/mood/MoodCalendar.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, parseISO } from 'date-fns';
import { FaChevronLeft, FaChevronRight, FaCalendarAlt } from 'react-icons/fa';
import { Mood } from '../../types';

interface MoodCalendarProps {
  entries: Mood[];
  onDateSelect: (date: string) => void;
  selectedDate?: string;
}

const MOOD_EMOJI_MAP: Record<number, string> = {
  1: '😢',
  2: '😔',
  3: '😐',
  4: '🙂',
  5: '😊',
};

const MOOD_COLOR_MAP: Record<number, string> = {
  1: 'bg-red-500',
  2: 'bg-yellow-500',
  3: 'bg-gray-400',
  4: 'bg-blue-400',
  5: 'bg-green-500',
};

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const MoodCalendar: React.FC<MoodCalendarProps> = ({
  entries,
  onDateSelect,
  selectedDate
}) => {
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());

  // 使用 useMemo 缓存月份数据计算
  const { monthStart, monthEnd, monthDays } = useMemo(() => {
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    const days = eachDayOfInterval({ start, end });
    return { monthStart: start, monthEnd: end, monthDays: days };
  }, [currentMonth]);

  // 使用 useMemo 缓存当前月份的心情记录
  const monthEntries = useMemo(() => {
    return entries.filter(entry => {
      try {
        const entryDate = parseISO(entry.date);
        return isSameMonth(entryDate, currentMonth);
      } catch (error) {
        console.error('Error parsing date:', error);
        return false;
      }
    });
  }, [entries, currentMonth]);

  // 使用 useMemo 计算统计数据，避免无限循环
  const moodStats = useMemo(() => {
    if (monthEntries.length === 0) {
      return {
        average: 0,
        bestDay: null as string | null,
        worstDay: null as string | null,
      };
    }

    const total = monthEntries.reduce((sum, entry) => sum + entry.mood_score, 0);
    const average = Math.round((total / monthEntries.length) * 10) / 10;
    
    let bestDay = monthEntries[0];
    let worstDay = monthEntries[0];
    
    monthEntries.forEach(entry => {
      if (entry.mood_score > bestDay.mood_score) bestDay = entry;
      if (entry.mood_score < worstDay.mood_score) worstDay = entry;
    });
    
    return {
      average,
      bestDay: bestDay.date,
      worstDay: worstDay.date,
    };
  }, [monthEntries]);

  const handlePrevMonth = () => {
    setCurrentMonth(prev => subMonths(prev, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth(prev => addMonths(prev, 1));
  };

  const handleToday = () => {
    setCurrentMonth(new Date());
  };

  // 使用 useMemo 缓存获取心情的函数
  const getMoodForDate = useMemo(() => {
    return (date: Date): Mood | undefined => {
      return monthEntries.find(entry => {
        try {
          const entryDate = parseISO(entry.date);
          return isSameDay(entryDate, date);
        } catch (error) {
          return false;
        }
      });
    };
  }, [monthEntries]);

  const getMoodClass = (moodScore?: number): string => {
    if (!moodScore) return 'bg-gray-100 hover:bg-gray-200';
    
    const colorClass = MOOD_COLOR_MAP[moodScore] || 'bg-gray-400';
    return `${colorClass} text-white hover:opacity-90`;
  };

  const getMoodLabel = (moodScore?: number): string => {
    if (!moodScore) return '';
    const labels = ['Very Bad', 'Bad', 'Neutral', 'Good', 'Excellent'];
    return labels[moodScore - 1] || '';
  };

  // 生成日历网格
  const firstDayOfMonth = monthStart.getDay();
  const days = [
    ...Array(firstDayOfMonth).fill(null),
    ...monthDays
  ];

  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      {/* 日历头部 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center">
          <FaCalendarAlt className="w-5 h-5 text-gray-500 mr-2" />
          <h2 className="text-xl font-semibold text-gray-900">Mood Calendar</h2>
        </div>
        
        <div className="flex items-center space-x-4">
          <button
            onClick={handlePrevMonth}
            className="p-2 hover:bg-gray-100 rounded-lg"
            type="button"
          >
            <FaChevronLeft className="w-5 h-5" />
          </button>
          
          <div className="text-lg font-semibold">
            {format(currentMonth, 'MMMM yyyy')}
          </div>
          
          <button
            onClick={handleNextMonth}
            className="p-2 hover:bg-gray-100 rounded-lg"
            type="button"
          >
            <FaChevronRight className="w-5 h-5" />
          </button>
          
          <button
            onClick={handleToday}
            className="px-4 py-2 text-sm bg-primary-50 text-primary-600 rounded-lg hover:bg-primary-100"
            type="button"
          >
            Today
          </button>
        </div>
      </div>

      {/* 月份统计 */}
      {monthEntries.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="text-sm text-gray-600 mb-1">Average Mood</div>
            <div className="text-2xl font-bold text-gray-900">
              {moodStats.average.toFixed(1)}/5
            </div>
            <div className="text-sm text-gray-500 mt-1">
              {monthEntries.length} days tracked
            </div>
          </div>
          
          {moodStats.bestDay && (
            <div className="bg-green-50 rounded-lg p-4">
              <div className="text-sm text-green-600 mb-1">Best Day</div>
              <div className="text-lg font-semibold text-green-800">
                {format(parseISO(moodStats.bestDay), 'MMM d')}
              </div>
              <div className="text-2xl mt-1">
                {MOOD_EMOJI_MAP[5]}
              </div>
            </div>
          )}
          
          {moodStats.worstDay && (
            <div className="bg-red-50 rounded-lg p-4">
              <div className="text-sm text-red-600 mb-1">Worst Day</div>
              <div className="text-lg font-semibold text-red-800">
                {format(parseISO(moodStats.worstDay), 'MMM d')}
              </div>
              <div className="text-2xl mt-1">
                {MOOD_EMOJI_MAP[1]}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 星期标题 */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {DAYS_OF_WEEK.map(day => (
          <div key={day} className="text-center text-sm font-medium text-gray-500 py-2">
            {day}
          </div>
        ))}
      </div>

      {/* 日历网格 */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((date, index) => {
          if (!date) {
            return <div key={`empty-${index}`} className="h-12"></div>;
          }

          const moodEntry = getMoodForDate(date);
          const isSelected = selectedDate && isSameDay(parseISO(selectedDate), date);
          const isToday = isSameDay(date, new Date());
          const moodScore = moodEntry?.mood_score;
          
          return (
            <button
              key={date.toISOString()}
              onClick={() => onDateSelect(format(date, 'yyyy-MM-dd'))}
              className={`
                h-12 flex flex-col items-center justify-center rounded-lg
                transition-all duration-200 relative
                ${getMoodClass(moodScore)}
                ${isSelected ? 'ring-2 ring-primary-500 ring-offset-2' : ''}
                ${isToday && !moodEntry ? 'border-2 border-primary-500' : ''}
              `}
              title={moodEntry ? `${format(date, 'MMM d')}: ${getMoodLabel(moodScore)}` : format(date, 'MMM d')}
              type="button"
            >
              <div className={`
                text-sm font-medium
                ${moodScore ? 'text-white' : 'text-gray-700'}
                ${isToday ? 'font-bold' : ''}
              `}>
                {format(date, 'd')}
              </div>
              
              {moodScore && (
                <div className="text-lg mt-1">
                  {MOOD_EMOJI_MAP[moodScore] || '😐'}
                </div>
              )}
              
              {isToday && !moodEntry && (
                <div className="absolute -top-1 -right-1 w-2 h-2 bg-primary-500 rounded-full"></div>
              )}
            </button>
          );
        })}
      </div>

      {/* 图例 */}
      <div className="mt-8 pt-6 border-t">
        <div className="text-sm font-medium text-gray-700 mb-3">Mood Legend</div>
        <div className="flex flex-wrap gap-3">
          {[1, 2, 3, 4, 5].map(score => (
            <div key={score} className="flex items-center">
              <div className={`w-4 h-4 rounded ${MOOD_COLOR_MAP[score] || 'bg-gray-400'} mr-2`}></div>
              <span className="text-sm text-gray-600 mr-2">
                {score}/5
              </span>
              <span className="text-lg mr-1">{MOOD_EMOJI_MAP[score] || '😐'}</span>
              <span className="text-xs text-gray-500">{getMoodLabel(score)}</span>
            </div>
          ))}
          <div className="flex items-center ml-4">
            <div className="w-4 h-4 bg-gray-100 border border-gray-300 rounded mr-2"></div>
            <span className="text-sm text-gray-600">No entry</span>
          </div>
          <div className="flex items-center">
            <div className="w-4 h-4 border-2 border-primary-500 rounded mr-2"></div>
            <span className="text-sm text-gray-600">Today</span>
          </div>
        </div>
      </div>

      {/* 月份记录总结 */}
      {monthEntries.length > 0 && (
        <div className="mt-6 pt-6 border-t">
          <div className="text-sm font-medium text-gray-700 mb-3">
            {format(currentMonth, 'MMMM')} Summary
          </div>
          <div className="space-y-2">
            {monthEntries
              .sort((a, b) => b.mood_score - a.mood_score)
              .slice(0, 3)
              .map(entry => (
                <div
                  key={entry.id}
                  className="flex items-center p-2 hover:bg-gray-50 rounded-lg cursor-pointer"
                  onClick={() => onDateSelect(entry.date)}
                >
                  <div className="text-2xl mr-3">{entry.mood_emoji}</div>
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">
                      {format(parseISO(entry.date), 'MMMM d')}
                    </div>
                    <div className="text-sm text-gray-600 truncate">
                      {entry.content.substring(0, 60)}...
                    </div>
                  </div>
                  <div className={`px-2 py-1 rounded text-xs ${MOOD_COLOR_MAP[entry.mood_score] || 'bg-gray-400'} text-white`}>
                    {entry.mood_score}/5
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
};