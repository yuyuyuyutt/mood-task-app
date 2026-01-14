//src\api\index.ts
import { Task, Mood } from '../types';

// 模拟数据存储
const storage = {
  tasks: [] as Task[],
  moods: [] as Mood[],
  
  init() {
    // 初始化一些示例数据
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    
    this.moods = [
      {
        id: 1,
        date: today,
        mood_score: 4,
        mood_emoji: '🙂',
        content: 'Had a productive day working on the new project. Feeling accomplished!',
        tags: ['Work', 'Productive'],
        created_at: new Date().toISOString(),
      },
      {
        id: 2,
        date: yesterday,
        mood_score: 3,
        mood_emoji: '😐',
        content: 'A bit tired today. Took it easy and caught up on some reading.',
        tags: ['Relaxing'],
        created_at: new Date(Date.now() - 86400000).toISOString(),
      }
    ];
    
    // 保存到 localStorage
    this.save();
  },
  
  save() {
    try {
      localStorage.setItem('mood-task-app-tasks', JSON.stringify(this.tasks));
      localStorage.setItem('mood-task-app-moods', JSON.stringify(this.moods));
    } catch (error) {
      console.error('Failed to save to localStorage:', error);
    }
  },
  
  load() {
    try {
      const tasks = localStorage.getItem('mood-task-app-tasks');
      const moods = localStorage.getItem('mood-task-app-moods');
      if (tasks) this.tasks = JSON.parse(tasks);
      if (moods) this.moods = JSON.parse(moods);
    } catch (error) {
      console.error('Failed to load from localStorage:', error);
      // 如果加载失败，使用初始化数据
      this.init();
    }
  }
};

// 初始化存储
storage.load();

export const api = {
  // 任务相关 API
  async getTasks(): Promise<Task[]> {
    return [...storage.tasks];
  },
  
  async createTask(task: Omit<Task, 'id' | 'created_at'>): Promise<number> {
    const newTask: Task = {
      ...task,
      id: Date.now(),
      created_at: new Date().toISOString(),
    };
    storage.tasks.push(newTask);
    storage.save();
    return newTask.id;
  },
  
  async updateTaskStatus(id: number, status: Task['status']): Promise<void> {
    const task = storage.tasks.find(t => t.id === id);
    if (task) {
      task.status = status;
      if (status === 'completed') {
        task.completed_at = new Date().toISOString();
      }
      storage.save();
    }
  },
  
  async deleteTask(id: number): Promise<void> {
    storage.tasks = storage.tasks.filter(t => t.id !== id);
    storage.save();
  },
  
  // 心情相关 API
  async getMoods(): Promise<Mood[]> {
    return [...storage.moods];
  },
  
  async getMoodsByMonth(year: number, month: number): Promise<Mood[]> {
    return storage.moods.filter(mood => {
      const date = new Date(mood.date);
      return date.getFullYear() === year && (date.getMonth() + 1) === month;
    });
  },
  
  async saveMood(mood: Omit<Mood, 'id' | 'created_at'>): Promise<number> {
    const existingIndex = storage.moods.findIndex(m => m.date === mood.date);
    
    if (existingIndex >= 0) {
      storage.moods[existingIndex] = {
        ...storage.moods[existingIndex],
        ...mood,
      };
      storage.save();
      return storage.moods[existingIndex].id;
    } else {
      const newMood: Mood = {
        ...mood,
        id: Date.now(),
        created_at: new Date().toISOString(),
      };
      storage.moods.push(newMood);
      storage.save();
      return newMood.id;
    }
  },
  
  async deleteMood(id: number): Promise<void> {
    storage.moods = storage.moods.filter(m => m.id !== id);
    storage.save();
  },
  
  // 统计数据
  async getStatistics() {
    const completedTasks = storage.tasks.filter(t => t.status === 'completed').length;
    const totalTasks = storage.tasks.length;
    const completionRate = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;
    
    const totalEnergy = storage.tasks.reduce((sum, task) => sum + (task.energy_cost || 0), 0);
    
    const avgMood = storage.moods.length > 0 
      ? storage.moods.reduce((sum, mood) => sum + mood.mood_score, 0) / storage.moods.length 
      : 0;
    
    // 计算情绪趋势
    const recentMoods = [...storage.moods]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 7);
    
    const moodTrend = recentMoods.map(mood => mood.mood_score);
    
    return {
      tasks: {
        completed: completedTasks,
        total: totalTasks,
        completionRate,
        totalEnergy,
      },
      moods: {
        average: Math.round(avgMood * 10) / 10,
        totalEntries: storage.moods.length,
        trend: moodTrend,
      },
    };
  },

  async updateTask(id: number, taskData: Partial<Task>): Promise<void> {
    const tasks = await this.getTasks();
    const index = tasks.findIndex(t => t.id === id);
    if (index !== -1) {
      tasks[index] = { ...tasks[index], ...taskData };
      // 这里保存到 localStorage
      localStorage.setItem('mood-task-app-tasks', JSON.stringify(tasks));
    }
  },
};