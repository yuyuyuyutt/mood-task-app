// src/plugins/pages/moodData.ts
// 心情日记数据的读写助手（与具体插件解耦，核心统计页可复用）。
// 数据模型：collection="entries"，key=日期，value=心情记录对象。
import type { Mood } from '../../types';
import type { DataRecord } from '../runtime';
import type { PluginDataAccess } from '../runtime/dataStore';

export const MOOD_COLLECTION = 'entries';

interface MoodEntryValue {
  mood_score: number;
  mood_emoji: string;
  content: string;
  tags?: string[];
  created_at?: string;
}

/** 从数据记录还原为 Mood 列表（按日期倒序） */
export function recordsToMoods(records: DataRecord[]): Mood[] {
  return records
    .map((r) => {
      const v = (r.value ?? {}) as MoodEntryValue;
      return {
        id: r.key as unknown as number,
        date: r.key,
        mood_score: Number(v.mood_score) || 0,
        mood_emoji: String(v.mood_emoji || '😐'),
        content: String(v.content || ''),
        tags: Array.isArray(v.tags) ? v.tags.filter((t) => typeof t === 'string') : [],
        created_at: v.created_at || r.updatedAt,
      };
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export async function loadMoodEntries(access: PluginDataAccess): Promise<Mood[]> {
  const records = await access.list(MOOD_COLLECTION);
  return recordsToMoods(records);
}

export async function saveMoodEntry(
  access: PluginDataAccess,
  mood: Omit<Mood, 'id' | 'created_at'>,
): Promise<void> {
  const value: MoodEntryValue = {
    mood_score: mood.mood_score,
    mood_emoji: mood.mood_emoji,
    content: mood.content,
    tags: Array.isArray(mood.tags) ? mood.tags.slice(0, 20) : [],
    created_at: new Date().toISOString(),
  };
  await access.put(MOOD_COLLECTION, mood.date, value);
}

export async function deleteMoodEntry(access: PluginDataAccess, date: string): Promise<void> {
  await access.remove(MOOD_COLLECTION, date);
}
