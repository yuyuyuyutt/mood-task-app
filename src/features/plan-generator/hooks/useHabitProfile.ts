// src/features/plan-generator/hooks/useHabitProfile.ts
// 个人画像 Hook：本地分析 + 持久化（IndexedDB kv）+ 手动修正。
import { useCallback, useEffect, useState } from 'react';
import { analyzeHabit } from '../services/habitAnalyzer';
import type { EventSample, HabitProfile, TaskSample, UserType } from '../types';
import { KV_PROFILE, kvGet, kvSet } from '../db/plannerDB';

interface StoredProfile {
  profile: HabitProfile;
  /** 手动修正的类型（存在时优先展示，重新分析不会被覆盖） */
  override?: UserType;
}

export interface UseHabitProfileResult {
  profile: HabitProfile | null;
  /** 用户手动修正后的类型（无修正时 = 推断类型） */
  effectiveUserType: UserType | null;
  loading: boolean;
  /** 用最近任务/事件重新分析并落盘（不覆盖手动修正） */
  analyze: (tasks: TaskSample[], events?: EventSample[]) => Promise<HabitProfile>;
  /** 手动修正用户类型 */
  setOverride: (type: UserType) => Promise<void>;
  /** 清除手动修正，回到推断结果 */
  clearOverride: () => Promise<void>;
}

export function useHabitProfile(): UseHabitProfileResult {
  const [stored, setStored] = useState<StoredProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    kvGet<StoredProfile>(KV_PROFILE)
      .then((s) => {
        if (alive) setStored(s ?? null);
      })
      .catch((err) => console.warn('读取个人画像失败:', err))
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const persist = useCallback(async (next: StoredProfile) => {
    setStored(next);
    await kvSet(KV_PROFILE, next);
  }, []);

  const analyze = useCallback(
    async (tasks: TaskSample[], events: EventSample[] = []): Promise<HabitProfile> => {
      const profile = analyzeHabit(tasks, events);
      const next: StoredProfile = { profile, override: stored?.override };
      await persist(next);
      return profile;
    },
    [stored, persist],
  );

  const setOverride = useCallback(
    async (type: UserType) => {
      if (!stored?.profile) return;
      await persist({ ...stored, override: type });
    },
    [stored, persist],
  );

  const clearOverride = useCallback(async () => {
    if (!stored) return;
    await persist({ profile: stored.profile, override: undefined });
  }, [stored, persist]);

  const effectiveUserType =
    stored?.override ?? stored?.profile.userType ?? null;

  return { profile: stored?.profile ?? null, effectiveUserType, loading, analyze, setOverride, clearOverride };
}
