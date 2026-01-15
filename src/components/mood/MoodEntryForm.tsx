//src/components/mood/MoodEntryForm.tsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { format } from 'date-fns';
import { Mood } from '../../types';
import { FaCalendarAlt, FaTag } from 'react-icons/fa';

interface MoodOption {
  emoji: string;
  score: number;
  label: string;
  color: string;
}

interface MoodEntryFormProps {
  date?: string;
  existingEntry?: Mood;
  onSubmit: (mood: Omit<Mood, 'id' | 'created_at'>) => void;
  onCancel?: () => void;
}

const DEFAULT_MOOD_OPTIONS: MoodOption[] = [
  { emoji: '😊', score: 5, label: '漂亮的一天', color: 'bg-green-100 text-green-800' },
  { emoji: '🙂', score: 4, label: '还行', color: 'bg-blue-100 text-blue-800' },
  { emoji: '😐', score: 3, label: '一般', color: 'bg-gray-100 text-gray-800' },
  { emoji: '😔', score: 2, label: '不开心', color: 'bg-yellow-100 text-yellow-800' },
  { emoji: '😢', score: 1, label: '糟糕透了', color: 'bg-red-100 text-red-800' },
];

const TAG_OPTIONS = [
  'Work', 'Personal', 'Health', 'Family', 'Friends', 
  'Exercise', 'Creative', 'Learning', 'Relaxing', 'Stressful'
];

export const MoodEntryForm: React.FC<MoodEntryFormProps> = ({
  date = format(new Date(), 'yyyy-MM-dd'),
  existingEntry,
  onSubmit,
  onCancel
}) => {
  const [formData, setFormData] = useState({
    date,
    mood_score: existingEntry?.mood_score || 3,
    mood_emoji: existingEntry?.mood_emoji || '😐',
    content: existingEntry?.content || '',
    tags: existingEntry?.tags || [] as string[],
  });

  const [selectedTag, setSelectedTag] = useState('');
  const [contentLength, setContentLength] = useState(existingEntry?.content?.length || 0);

  // 使用 useMemo 确保每次渲染时 stableDate 引用不变
  const stableDate = useMemo(() => date, [date]);
  
  // 使用 useMemo 确保 existingEntry 的稳定引用（通过浅比较）
  const stableExistingEntry = useMemo(() => existingEntry, 
    [existingEntry?.id, existingEntry?.mood_score, existingEntry?.mood_emoji, 
     existingEntry?.content, JSON.stringify(existingEntry?.tags)]);

  useEffect(() => {
    setFormData({
      date: stableDate,
      mood_score: stableExistingEntry?.mood_score || 3,
      mood_emoji: stableExistingEntry?.mood_emoji || '😐',
      content: stableExistingEntry?.content || '',
      tags: stableExistingEntry?.tags || [],
    });
    setContentLength(stableExistingEntry?.content?.length || 0);
  }, [stableDate, stableExistingEntry]);

  const handleMoodSelect = useCallback((option: MoodOption) => {
    setFormData(prev => ({
      ...prev,
      mood_score: option.score,
      mood_emoji: option.emoji,
    }));
  }, []);

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const content = e.target.value;
    setFormData(prev => ({ ...prev, content }));
    setContentLength(content.length);
  };

  const handleAddTag = useCallback(() => {
    if (selectedTag && !formData.tags.includes(selectedTag)) {
      setFormData(prev => ({
        ...prev,
        tags: [...prev.tags, selectedTag]
      }));
      setSelectedTag('');
    }
  }, [selectedTag, formData.tags]);

  const handleRemoveTag = useCallback((tagToRemove: string) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.filter(tag => tag !== tagToRemove)
    }));
  }, []);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    if (!formData.content.trim()) {
      alert('Please write something about your day');
      return;
    }

    onSubmit({
      date: formData.date,
      mood_score: formData.mood_score,
      mood_emoji: formData.mood_emoji,
      content: formData.content.trim(),
      tags: formData.tags.length > 0 ? formData.tags : undefined,
    });
  };

  const getMoodOption = useCallback((score: number) => {
    return DEFAULT_MOOD_OPTIONS.find(option => option.score === score) || DEFAULT_MOOD_OPTIONS[2];
  }, []);

  const selectedMoodOption = getMoodOption(formData.mood_score);

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-gray-900">
          {stableExistingEntry ? '这天怎么了' : '我在听哦'}
        </h2>
        <div className="flex items-center text-sm text-gray-600">
          <FaCalendarAlt className="w-4 h-4 mr-1" />
          <span>{format(new Date(formData.date), 'EEEE, MMMM d, yyyy')}</span>
        </div>
      </div>

      {/* Mood Selection */}
      <div className="mb-8">
        <label className="block text-sm font-medium text-gray-700 mb-4">
          今天怎么样呢，我的朋友
        </label>
        <div className="grid grid-cols-5 gap-2">
          {DEFAULT_MOOD_OPTIONS.map(option => (
            <button
              key={option.score}
              type="button"
              onClick={() => handleMoodSelect(option)}
              className={`
                flex flex-col items-center p-3 rounded-lg transition-all duration-200
                ${formData.mood_score === option.score
                  ? 'ring-2 ring-primary-500 transform scale-105'
                  : 'hover:bg-gray-50'
                }
              `}
            >
              <span className="text-3xl mb-2">{option.emoji}</span>
              <span className={`text-xs px-2 py-1 rounded-full ${option.color}`}>
                {option.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-3">
          发生了什么呢
          <span className="ml-2 text-xs text-gray-500">
            {contentLength}/500
          </span>
        </label>
        <textarea
          className="input min-h-[120px] resize-none"
          placeholder="和我说说吧，我的朋友"
          value={formData.content}
          onChange={handleContentChange}
          maxLength={500}
        />
      </div>

      {/* Tags */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <label className="flex items-center text-sm font-medium text-gray-700">
            <FaTag className="w-4 h-4 mr-1" />
            Tags (Optional)
          </label>
          <span className="text-xs text-gray-500">Add up to 5 tags</span>
        </div>
        
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

        {formData.tags.length < 5 && (
          <div className="flex gap-2">
            <select
              className="flex-1 input"
              value={selectedTag}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedTag(e.target.value)}
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
              className="btn btn-secondary"
              disabled={!selectedTag}
            >
              Add Tag
            </button>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex justify-end space-x-3 pt-6 border-t">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="btn btn-secondary"
          >
            消失
          </button>
        )}
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!formData.content.trim()}
        >
          {stableExistingEntry ? '编辑' : '我记下了'}
        </button>
      </div>
    </form>
  );
};