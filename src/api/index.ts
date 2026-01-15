//src\api\index.ts
import { Task, Mood } from '../types';

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
        priority: task.priority as 1 | 2 | 3,
        tags: task.tags ? JSON.parse(task.tags) : []
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
          tags: task.tags ? JSON.stringify(task.tags) : null
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
          tags: task.tags ? JSON.stringify(task.tags) : null
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
          tags: updatedTask.tags ? JSON.stringify(updatedTask.tags) : null
        }
      });
    } catch (error) {
      console.error('Failed to update task:', error);
      throw error;
    }
  },
};