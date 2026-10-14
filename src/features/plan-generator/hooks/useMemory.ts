// src/features/plan-generator/hooks/useMemory.ts
// 记忆的读取/管理 Hook（设置页"记忆"卡片消费）。
// 与 useNetworkingSettings 同款结构：本地 IndexedDB，无网络。
import { useCallback, useEffect, useState } from 'react';
import type { MemoryNote } from '../types';
import {
  clearMemories,
  decayMemories,
  forgetMemory,
  isMemoryEnabled,
  listMemories,
  setMemoryEnabled,
  summarizeMemories,
  type MemoryStats,
} from '../services/memory/memoryStore';

const EMPTY_STATS: MemoryStats = {
  total: 0,
  episodic: 0,
  semantic: 0,
  accepted: 0,
  rejected: 0,
  archived: 0,
};

export interface UseMemoryResult {
  notes: MemoryNote[];
  stats: MemoryStats;
  loading: boolean;
  /** 记忆总开关（关闭后既不写入也不召回） */
  enabled: boolean;
  setEnabled: (enabled: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clear: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useMemory(): UseMemoryResult {
  const [notes, setNotes] = useState<MemoryNote[]>([]);
  const [enabled, setEnabledState] = useState(true);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const list = await listMemories();
    setNotes(list);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const on = await isMemoryEnabled();
        if (alive) setEnabledState(on);
        // 衰减维护：与插件数据的 purgeExpired 同款纪律，进设置页时顺手做一次
        await decayMemories().catch(() => undefined);
        if (alive) await refresh();
      } catch (err) {
        console.warn('读取记忆失败:', err);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [refresh]);

  const setEnabled = useCallback(async (next: boolean) => {
    setEnabledState(next);
    await setMemoryEnabled(next);
  }, []);

  const remove = useCallback(
    async (id: string) => {
      await forgetMemory(id);
      await refresh();
    },
    [refresh],
  );

  const clear = useCallback(async () => {
    await clearMemories();
    await refresh();
  }, [refresh]);

  return {
    notes,
    stats: notes.length > 0 ? summarizeMemories(notes) : EMPTY_STATS,
    loading,
    enabled,
    setEnabled,
    remove,
    clear,
    refresh,
  };
}
