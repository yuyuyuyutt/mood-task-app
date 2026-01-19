//src\api\index.ts
import { Task, Mood} from '../types';

// Tauri 导入
import { invoke } from '@tauri-apps/api/core';

// 任务相关 API
export const api = {
  // 获取所有任务
  async getTasks(): Promise<Task[]> {
    try {
      const tasks: any[] = await invoke('get_tasks');
      return tasks.map(task => ({
        ...task,
        tags: task.tags ? JSON.parse(task.tags) : [],
        is_habit: task.is_habit || false,
        habit_period: task.habit_period || 'daily',
        habit_completions: task.habit_completions ? JSON.parse(task.habit_completions) : [],
        habit_start_date: task.habit_start_date || '',
        habit_end_date: task.habit_end_date || ''
      }));
    } catch (error) {
      console.error('Failed to get tasks:', error);
      return [];
    }
  },
  
  // 创建新任务
  async createTask(task: Omit<Task, 'id' | 'created_at'>): Promise<number> {
    try {
      const newTask = await invoke('create_task', {
        task: {
          title: task.title,
          description: task.description || null,
          status: task.status || 'pending',
          priority: task.priority || 2,
          energy_cost: task.energy_cost || null,
          estimated_time: task.estimated_time || null,
          actual_time: task.actual_time || null,
          due_date: task.due_date || null,
          tags: task.tags ? JSON.stringify(task.tags) : null,
          // 习惯任务字段
          is_habit: task.is_habit || false,
          habit_period: task.habit_period || null,
          habit_completions: task.habit_completions ? JSON.stringify(task.habit_completions) : '[]',
          habit_start_date: task.habit_start_date || null,
          habit_end_date: task.habit_end_date || null
        }
      }) as any;
      
      return newTask.id;
    } catch (error) {
      console.error('Failed to create task:', error);
      throw error;
    }
  },
  
  // 更新任务状态
  async updateTaskStatus(id: number, status: Task['status']): Promise<void> {
    try {
      // 首先获取任务
      const tasks = await this.getTasks();
      const task = tasks.find(t => t.id === id);
      
      if (!task) {
        throw new Error(`Task with id ${id} not found`);
      }
      
      // 调用更新接口
      await invoke('update_task', {
        id,
        task: {
          title: task.title,
          description: task.description || null,
          status: status,
          priority: task.priority,
          energy_cost: task.energy_cost || null,
          estimated_time: task.estimated_time || null,
          actual_time: task.actual_time || null,
          due_date: task.due_date || null,
          tags: task.tags ? JSON.stringify(task.tags) : null,
          // 习惯任务字段
          is_habit: task.is_habit || false,
          habit_period: task.habit_period || null,
          habit_completions: task.habit_completions ? JSON.stringify(task.habit_completions) : '[]',
          habit_start_date: task.habit_start_date || null,
          habit_end_date: task.habit_end_date || null
        }
      });
    } catch (error) {
      console.error('Failed to update task status:', error);
      throw error;
    }
  },
  
  // 删除任务
  async deleteTask(id: number): Promise<void> {
    try {
      await invoke('delete_task', { id });
    } catch (error) {
      console.error('Failed to delete task:', error);
      throw error;
    }
  },
  
  // 获取所有心情记录
  async getMoods(): Promise<Mood[]> {
    try {
      const moods: any[] = await invoke('get_moods');
      return moods.map(mood => ({
        ...mood,
        tags: mood.tags ? JSON.parse(mood.tags) : []
      }));
    } catch (error) {
      console.error('Failed to get moods:', error);
      return [];
    }
  },
  
  // 获取指定月份的心情记录
  async getMoodsByMonth(year: number, month: number): Promise<Mood[]> {
    try {
      const allMoods = await this.getMoods();
      return allMoods.filter(mood => {
        const date = new Date(mood.date);
        return date.getFullYear() === year && (date.getMonth() + 1) === month;
      });
    } catch (error) {
      console.error('Failed to get moods by month:', error);
      return [];
    }
  },
  
  // 保存心情记录（创建或更新）
  async saveMood(mood: Omit<Mood, 'id' | 'created_at'>): Promise<number> {
    try {
      const savedMood = await invoke('save_mood', {
        mood: {
          date: mood.date,
          mood_score: mood.mood_score,
          mood_emoji: mood.mood_emoji,
          content: mood.content,
          tags: mood.tags ? JSON.stringify(mood.tags) : null
        }
      }) as any;
      
      return savedMood.id;
    } catch (error) {
      console.error('Failed to save mood:', error);
      throw error;
    }
  },
  
  // 删除心情记录
  async deleteMood(id: number): Promise<void> {
    try {
      await invoke('delete_mood', { id });
    } catch (error) {
      console.error('Failed to delete mood:', error);
      throw error;
    }
  },
  
  // 获取统计数据
  async getStatistics() {
    try {
      const [tasks, moods] = await Promise.all([
        this.getTasks(),
        this.getMoods()
      ]);
      
      const completedTasks = tasks.filter(t => t.status === 'completed').length;
      const totalTasks = tasks.length;
      const completionRate = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;
      
      const totalEnergy = tasks.reduce((sum, task) => sum + (task.energy_cost || 0), 0);
      
      const avgMood = moods.length > 0 
        ? moods.reduce((sum, mood) => sum + mood.mood_score, 0) / moods.length 
        : 0;
      
      // 计算情绪趋势（最近7天）
      const recentMoods = [...moods]
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 7);
      
      const moodTrend = recentMoods.map(mood => mood.mood_score);
      
      // 计算习惯任务统计
      const habitTasks = tasks.filter(task => task.is_habit);
      const today = new Date().toISOString().split('T')[0];
      let todayHabitsCompleted = 0;
      
      for (const habit of habitTasks) {
        const completions = habit.habit_completions || [];
        const todayCompletion = completions.find((c: any) => c.date === today && c.status === 'completed');
        if (todayCompletion) todayHabitsCompleted++;
      }
      
      return {
        tasks: {
          completed: completedTasks,
          total: totalTasks,
          completionRate,
          totalEnergy,
        },
        moods: {
          average: Math.round(avgMood * 10) / 10,
          totalEntries: moods.length,
          trend: moodTrend,
        },
        habits: {
          total: habitTasks.length,
          todayCompleted: todayHabitsCompleted,
          completionRate: habitTasks.length > 0 ? Math.round((todayHabitsCompleted / habitTasks.length) * 100) : 0
        }
      };
    } catch (error) {
      console.error('Failed to get statistics:', error);
      throw error;
    }
  },

  // 更新任务（完整更新）
  async updateTask(id: number, taskData: Partial<Task>): Promise<void> {
    try {
      // 首先获取任务
      const tasks = await this.getTasks();
      const task = tasks.find(t => t.id === id);
      
      if (!task) {
        throw new Error(`Task with id ${id} not found`);
      }
      
      // 合并更新
      const updatedTask = { ...task, ...taskData };
      
      // 调用更新接口
      await invoke('update_task', {
        id,
        task: {
          title: updatedTask.title,
          description: updatedTask.description || null,
          status: updatedTask.status || 'pending',
          priority: updatedTask.priority,
          energy_cost: updatedTask.energy_cost || null,
          estimated_time: updatedTask.estimated_time || null,
          actual_time: updatedTask.actual_time || null,
          due_date: updatedTask.due_date || null,
          tags: updatedTask.tags ? JSON.stringify(updatedTask.tags) : null,
          // 习惯任务字段
          is_habit: updatedTask.is_habit || false,
          habit_period: updatedTask.habit_period || null,
          habit_completions: updatedTask.habit_completions ? JSON.stringify(updatedTask.habit_completions) : '[]',
          habit_start_date: updatedTask.habit_start_date || null,
          habit_end_date: updatedTask.habit_end_date || null
        }
      });
    } catch (error) {
      console.error('Failed to update task:', error);
      throw error;
    }
  },

  // ============ 习惯任务相关 API ============

  // 更新习惯任务完成状态
  async updateHabitCompletion(taskId: number, date: string, status: 'completed' | 'skipped', note?: string): Promise<Task> {
    try {
      const updatedTask = await invoke('update_habit_completion', {
        taskId,
        date,
        status,
        note: note || null
      }) as any;
      
      return {
        ...updatedTask,
        tags: updatedTask.tags ? JSON.parse(updatedTask.tags) : [],
        habit_completions: updatedTask.habit_completions ? JSON.parse(updatedTask.habit_completions) : []
      };
    } catch (error) {
      console.error('Failed to update habit completion:', error);
      throw error;
    }
  },

  // 获取习惯任务的统计数据
  async getHabitStats(taskId: number): Promise<any> {
    try {
      const tasks = await this.getTasks();
      const task = tasks.find(t => t.id === taskId && t.is_habit);
      
      if (!task || !task.is_habit || !task.habit_start_date) {
        throw new Error('Task is not a habit or missing start date');
      }
      
      const startDate = new Date(task.habit_start_date);
      const endDate = task.habit_end_date ? new Date(task.habit_end_date) : new Date();
      const today = new Date();
      
      // 计算总天数
      const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      
      // 计算完成天数
      const completions = task.habit_completions || [];
      const completedDays = completions.filter((c: any) => c.status === 'completed').length;
      const skippedDays = completions.filter((c: any) => c.status === 'skipped').length;
      
      // 计算连续完成天数
      const sortedCompletions = [...completions]
        .filter((c: any) => c.status === 'completed')
        .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
      
      let streakDays = 0;
      let currentDate = new Date(today);
      
      for (const completion of sortedCompletions) {
        const completionDate = new Date(completion.date);
        if (completionDate.toDateString() === currentDate.toDateString()) {
          streakDays++;
          currentDate.setDate(currentDate.getDate() - 1);
        } else {
          break;
        }
      }
      
      // 计算完成率
      const completionRate = totalDays > 0 ? (completedDays / totalDays) * 100 : 0;
      
      // 最后完成日期
      const lastCompletion = sortedCompletions.length > 0 ? sortedCompletions[0].date : undefined;
      
      return {
        total_days: totalDays,
        completed_days: completedDays,
        skipped_days: skippedDays,
        streak_days: streakDays,
        completion_rate: Math.round(completionRate),
        last_completion: lastCompletion
      };
    } catch (error) {
      console.error('Failed to get habit stats:', error);
      throw error;
    }
  },

  // 检查今天是否需要完成习惯任务
  async checkTodayHabits(): Promise<Task[]> {
    try {
      const tasks = await this.getTasks();
      const today = new Date().toISOString().split('T')[0];
      const dayOfWeek = new Date().getDay(); // 0 = Sunday, 1 = Monday, etc.
      
      return tasks.filter(task => {
        if (!task.is_habit) return false;
        if (!task.habit_start_date) return false;
        
        // 检查是否在有效期内
        const startDate = new Date(task.habit_start_date);
        const endDate = task.habit_end_date ? new Date(task.habit_end_date) : null;
        const todayDate = new Date(today);
        
        if (todayDate < startDate) return false;
        if (endDate && todayDate > endDate) return false;
        
        // 检查周期
        switch (task.habit_period) {
          case 'daily':
            return true;
          case 'weekdays':
            return dayOfWeek >= 1 && dayOfWeek <= 5; // Monday to Friday
          case 'weekends':
            return dayOfWeek === 0 || dayOfWeek === 6; // Sunday or Saturday
          case 'custom':
            // 这里可以扩展自定义逻辑
            return true;
          default:
            return true;
        }
      });
    } catch (error) {
      console.error('Failed to check today habits:', error);
      return [];
    }
  },

  // 获取今天的习惯完成状态
  async getTodayHabitStatus(): Promise<{task: Task, completed: boolean, status?: string}[]> {
    try {
      const today = new Date().toISOString().split('T')[0];
      const todayHabits = await this.checkTodayHabits();
      
      return todayHabits.map(task => {
        const completions = task.habit_completions || [];
        const todayCompletion = completions.find((c: any) => c.date === today);
        
        return {
          task,
          completed: !!todayCompletion,
          status: todayCompletion?.status
        };
      });
    } catch (error) {
      console.error('Failed to get today habit status:', error);
      return [];
    }
  },

  // 获取所有习惯任务
  async getHabitTasks(): Promise<Task[]> {
    try {
      const tasks = await this.getTasks();
      return tasks.filter(task => task.is_habit);
    } catch (error) {
      console.error('Failed to get habit tasks:', error);
      return [];
    }
  },
};