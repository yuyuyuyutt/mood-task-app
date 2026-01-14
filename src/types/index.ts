//src/types/index.ts
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
}

export type FilterType = 'all' | 'today' | 'week' | 'completed' | 'pending';