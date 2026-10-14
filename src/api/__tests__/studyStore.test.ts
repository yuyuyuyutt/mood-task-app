// src/api/__tests__/studyStore.test.ts
// 学习工作区数据域：命名空间纪律、脏数据防御、排序、汇总口径。
// 用内存版 PluginDataStore 替身（只需要 list/get/put/remove 四个方法），
// 避免为了一个数据域测试去引 localStorage / Tauri IPC。
import { describe, expect, it } from 'vitest';
import {
  STUDY_NS,
  loadNotes,
  loadProgress,
  loadSessions,
  loadTutorThread,
  putNote,
  putProgress,
  putSession,
  putTutorThread,
  removeNote,
  removeSession,
  summarizeStudyData,
} from '../studyStore';
import type { PluginDataStore } from '../../plugins/runtime';
import type { StudyNote, StudySession } from '../../features/study/types';

interface Row {
  namespace: string;
  collection: string;
  key: string;
  value: unknown;
}

function memoryStore(): PluginDataStore & { rows: Row[] } {
  const rows: Row[] = [];
  const at = (ns: string, c: string, k: string) => rows.find((r) => r.namespace === ns && r.collection === c && r.key === k);
  const store = {
    rows,
    list: async (_identity: string, namespace: string, collection: string) =>
      rows
        .filter((r) => r.namespace === namespace && r.collection === collection)
        .map((r) => ({ key: r.key, value: r.value, updatedAt: '2026-09-28T00:00:00.000Z' })),
    get: async (_identity: string, namespace: string, collection: string, key: string) =>
      at(namespace, collection, key)?.value,
    put: async (_identity: string, namespace: string, collection: string, key: string, value: unknown) => {
      const existing = at(namespace, collection, key);
      if (existing) existing.value = value;
      else rows.push({ namespace, collection, key, value });
    },
    remove: async (_identity: string, namespace: string, collection: string, key: string) => {
      const index = rows.findIndex((r) => r.namespace === namespace && r.collection === collection && r.key === key);
      if (index >= 0) rows.splice(index, 1);
    },
  };
  return store as unknown as PluginDataStore & { rows: Row[] };
}

function session(over: Partial<StudySession> = {}): StudySession {
  return {
    id: 's1',
    startedAt: '2026-09-28T09:00:00.000Z',
    endedAt: '2026-09-28T09:25:00.000Z',
    minutes: 25,
    goal: '学习 Python 基础',
    ...over,
  };
}

describe('studyStore：命名空间与读写', () => {
  it('数据写在宿主保留命名空间 __study 下（插件不可声明，因此不会撞车）', async () => {
    const store = memoryStore();
    await putSession(store, session());
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].namespace).toBe(STUDY_NS);
    expect(store.rows[0].namespace).toBe('__study');
    expect(store.rows[0].collection).toBe('sessions');
  });

  it('会话：按开始时间倒序返回', async () => {
    const store = memoryStore();
    await putSession(store, session({ id: 'older', startedAt: '2026-09-27T09:00:00.000Z' }));
    await putSession(store, session({ id: 'newer', startedAt: '2026-09-28T09:00:00.000Z' }));
    const sessions = await loadSessions(store);
    expect(sessions.map((s) => s.id)).toEqual(['newer', 'older']);
  });

  it('会话：删除生效', async () => {
    const store = memoryStore();
    await putSession(store, session());
    await removeSession(store, 's1');
    expect(await loadSessions(store)).toEqual([]);
  });

  it('脏数据被过滤掉（旧版本 / 手改 localStorage 都不会让页面崩）', async () => {
    const store = memoryStore();
    store.rows.push({ namespace: STUDY_NS, collection: 'sessions', key: 'bad', value: { id: 'x' } });
    store.rows.push({ namespace: STUDY_NS, collection: 'notes', key: 'bad', value: 'not-an-object' });
    expect(await loadSessions(store)).toEqual([]);
    expect(await loadNotes(store)).toEqual([]);
  });

  it('笔记：覆盖写入并按更新时间倒序', async () => {
    const store = memoryStore();
    const base: StudyNote = {
      id: 'n1',
      createdAt: '2026-09-28T00:00:00.000Z',
      updatedAt: '2026-09-28T10:00:00.000Z',
      title: '列表推导式',
      body: '把循环压成一行',
      tags: ['python'],
    };
    await putNote(store, base);
    await putNote(store, { ...base, body: '改过的内容', updatedAt: '2026-09-28T11:00:00.000Z' });
    await putNote(store, { ...base, id: 'n2', updatedAt: '2026-09-28T09:00:00.000Z' });

    const notes = await loadNotes(store);
    expect(notes.map((n) => n.id)).toEqual(['n1', 'n2']);
    expect(notes[0].body).toBe('改过的内容');
    await removeNote(store, 'n1');
    expect((await loadNotes(store)).map((n) => n.id)).toEqual(['n2']);
  });

  it('资源进度：以 resourceId 为键，便于 O(1) 查询', async () => {
    const store = memoryStore();
    await putProgress(store, {
      resourceId: 'r1',
      url: 'https://example.com/py',
      state: 'reading',
      minutesSpent: 12,
      readCount: 1,
    });
    const progress = await loadProgress(store);
    expect(progress.r1.state).toBe('reading');
    expect(progress.r1.minutesSpent).toBe(12);
    expect(progress.missing).toBeUndefined();
  });

  it('辅导记录：按资源读写；没有记录时返回 null', async () => {
    const store = memoryStore();
    expect(await loadTutorThread(store, 'r1')).toBeNull();
    await putTutorThread(store, {
      resourceId: 'r1',
      resourceTitle: 'Python 列表推导式',
      messages: [{ id: 'm1', role: 'user', content: '怎么写', createdAt: '2026-09-28T09:00:00.000Z' }],
      updatedAt: '2026-09-28T09:00:00.000Z',
    });
    const thread = await loadTutorThread(store, 'r1');
    expect(thread?.messages).toHaveLength(1);
  });
});

describe('studyStore：汇总（同时用于"今天学了多少"与"备份里有多少条"）', () => {
  it('统计会话/笔记/进度/辅导，并按本地日期算今天的学习分钟', async () => {
    const store = memoryStore();
    const now = new Date('2026-09-28T20:00:00');
    await putSession(store, session({ id: 'a', minutes: 25 }));
    await putSession(store, session({ id: 'b', minutes: 40, startedAt: '2026-09-27T09:00:00.000Z' }));
    await putProgress(store, {
      resourceId: 'r1',
      url: 'https://example.com/py',
      state: 'done',
      minutesSpent: 30,
      readCount: 2,
    });
    await putNote(store, {
      id: 'n1',
      createdAt: '2026-09-28T00:00:00.000Z',
      updatedAt: '2026-09-28T10:00:00.000Z',
      title: '标题',
      body: '内容',
      tags: [],
    });

    const summary = await summarizeStudyData(store, now);
    expect(summary).toMatchObject({
      sessions: 2,
      notes: 1,
      progress: 1,
      tutorThreads: 0,
      minutes: 65,
      todayMinutes: 25,
      resourcesDone: 1,
    });
  });
});
