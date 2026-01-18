// src/types/index.ts
export interface Task {
  id: number;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 1 | 2 | 3;
  energy_cost?: number;
  estimated_time?: number; // 分钟
  actual_time?: number;
  due_date?: string;
  completed_at?: string;
  tags?: string[];
  created_at: string;
  
  // 新增习惯任务字段
  is_habit?: boolean; // 是否为习惯任务
  habit_period?: HabitPeriod; // 习惯周期
  habit_completions?: HabitCompletion[]; // 完成记录
  habit_start_date?: string; // 习惯开始日期
  habit_end_date?: string; // 习惯结束日期（可选）
}

// 习惯周期类型
export type HabitPeriod = 'daily' | 'weekdays' | 'weekends' | 'custom';

// 习惯完成记录
export interface HabitCompletion {
  date: string; // 完成的日期
  completed_at: string; // 完成时间
  status: 'completed' | 'skipped';
  note?: string; // 备注
}

// 习惯统计
export interface HabitStats {
  total_days: number; // 总天数
  completed_days: number; // 完成天数
  streak_days: number; // 连续完成天数
  completion_rate: number; // 完成率
  last_completion?: string; // 最后完成日期
}

export interface Mood {
  id: number;
  date: string;
  mood_score: number; // 1-5
  mood_emoji: string;
  content: string;
  tags?: string[];
  created_at: string;
}

export interface Statistics {
  tasks_completed_today: number;
  total_tasks: number;
  mood_average_week: number;
  energy_spent_today: number;
  habit_stats?: HabitStats; // 新增习惯统计
}

export type FilterType = 'all' | 'today' | 'week' | 'completed' | 'pending' | 'habits';