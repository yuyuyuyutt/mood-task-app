// src/features/study/hooks/useStudyData.ts
// 学习工作区的数据门面：把 `studyStore` 的读写包成 React 状态。
//
// 原则：**写入失败不能让界面假装成功** —— 只有写进存储后才更新内存态，
// 否则用户会看到"笔记保存了"但重启后消失（这是最难排查的一类 bug）。
import { useCallback, useEffect, useState } from 'react';
import type { PluginDataStore } from '../../../plugins/runtime';
import {
  loadNotes,
  loadProgress,
  loadSessions,
  putNote,
  putProgress,
  putSession,
  removeNote,
  removeSession,
  summarizeStudyData,
  type StudyDataSummary,
} from '../../../api/studyStore';
import type { ResourceProgress, ResourceState, StudyNote, StudySession } from '../types';

export interface UseStudyDataResult {
  loading: boolean;
  sessions: StudySession[];
  notes: StudyNote[];
  progress: Record<string, ResourceProgress>;
  summary: StudyDataSummary;
  reload: () => Promise<void>;
  saveSession: (session: StudySession) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  saveNote: (note: StudyNote) => Promise<void>;
  removeNoteById: (id: string) => Promise<void>;
  /** 记录一次资源活动：打开/读完/累计分钟（自动累加 readCount） */
  markResource: (input: {
    resourceId: string;
    url: string;
    state?: ResourceState;
    minutes?: number;
  }) => Promise<void>;
}

const EMPTY_SUMMARY: StudyDataSummary = {
  sessions: 0,
  notes: 0,
  progress: 0,
  tutorThreads: 0,
  minutes: 0,
  todayMinutes: 0,
  resourcesDone: 0,
};

export function useStudyData(store: PluginDataStore): UseStudyDataResult {
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [notes, setNotes] = useState<StudyNote[]>([]);
  const [progress, setProgress] = useState<Record<string, ResourceProgress>>({});
  const [summary, setSummary] = useState<StudyDataSummary>(EMPTY_SUMMARY);

  const reload = useCallback(async () => {
    const [nextSessions, nextNotes, nextProgress, nextSummary] = await Promise.all([
      loadSessions(store),
      loadNotes(store),
      loadProgress(store),
      summarizeStudyData(store),
    ]);
    setSessions(nextSessions);
    setNotes(nextNotes);
    setProgress(nextProgress);
    setSummary(nextSummary);
  }, [store]);

  useEffect(() => {
    void (async () => {
      try {
        await reload();
      } finally {
        setLoading(false);
      }
    })();
  }, [reload]);

  const saveSession = useCallback(
    async (session: StudySession) => {
      await putSession(store, session);
      await reload();
    },
    [store, reload],
  );

  const deleteSession = useCallback(
    async (id: string) => {
      await removeSession(store, id);
      await reload();
    },
    [store, reload],
  );

  const saveNote = useCallback(
    async (note: StudyNote) => {
      await putNote(store, note);
      await reload();
    },
    [store, reload],
  );

  const removeNoteById = useCallback(
    async (id: string) => {
      await removeNote(store, id);
      await reload();
    },
    [store, reload],
  );

  const markResource = useCallback<UseStudyDataResult['markResource']>(
    async (input) => {
      const now = new Date().toISOString();
      const prev = progress[input.resourceId];
      const next: ResourceProgress = {
        resourceId: input.resourceId,
        url: input.url,
        state: input.state ?? prev?.state ?? 'reading',
        openedAt: prev?.openedAt ?? now,
        lastReadAt: now,
        minutesSpent: (prev?.minutesSpent ?? 0) + (input.minutes ?? 0),
        readCount: (prev?.readCount ?? 0) + (input.state === 'done' ? 1 : 0),
      };
      await putProgress(store, next);
      setProgress((current) => ({ ...current, [next.resourceId]: next }));
      const nextSummary = await summarizeStudyData(store);
      setSummary(nextSummary);
    },
    [store, progress],
  );

  return {
    loading,
    sessions,
    notes,
    progress,
    summary,
    reload,
    saveSession,
    deleteSession,
    saveNote,
    removeNoteById,
    markResource,
  };
}
