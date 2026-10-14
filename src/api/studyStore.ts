// src/api/studyStore.ts
// 「学习工作区」独立数据域：会话 / 笔记 / 资源进度 / 辅导记录。
//
// 与任务表、时段面板都解耦，落点照抄 `scheduleStore`：
//   - 复用插件数据基础设施（PluginDataStore）→ 桌面写 SQLite `plugin_data`，浏览器写 localStorage；
//   - 命名空间用宿主保留的 `__study`（插件清单禁止声明 `__` 前缀），不会与插件数据撞车；
//   - 因此**不需要改 Rust、不需要数据库迁移**。
//
// 备份口径（重要，已在界面上向用户交代）：
//   `PluginDataStore.dumpAll()` 是**按命名空间全量导出**，`restoreRows()` 也逐行写回，
//   所以 `__study` 下的数据天然随「数据备份」导出/恢复；`backupService` 额外按命名空间
//   统计学习工作区的行数，让"到底备了什么"在界面上可核对。
import type { PluginDataStore } from '../plugins/runtime';
import type {
  ResourceProgress,
  StudyNote,
  StudySession,
  TutorThread,
} from '../features/study/types';

/** 宿主保留命名空间（插件不可声明 `__` 前缀） */
export const STUDY_NS = '__study';
/** core 身份：拥有全部读写删权限 */
export const CORE_IDENTITY = 'core';

export const STUDY_COLLECTIONS = ['sessions', 'notes', 'progress', 'tutor'] as const;
export type StudyCollection = (typeof STUDY_COLLECTIONS)[number];

// ---------------- 防御性校验（localStorage / 旧版本数据可能脏） ----------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object';
}

function isSession(v: unknown): v is StudySession {
  if (!isRecord(v)) return false;
  return (
    typeof v.id === 'string' &&
    typeof v.startedAt === 'string' &&
    typeof v.endedAt === 'string' &&
    typeof v.minutes === 'number' &&
    typeof v.goal === 'string'
  );
}

function isNote(v: unknown): v is StudyNote {
  if (!isRecord(v)) return false;
  return (
    typeof v.id === 'string' &&
    typeof v.title === 'string' &&
    typeof v.body === 'string' &&
    Array.isArray(v.tags)
  );
}

function isProgress(v: unknown): v is ResourceProgress {
  if (!isRecord(v)) return false;
  return (
    typeof v.resourceId === 'string' &&
    typeof v.url === 'string' &&
    (v.state === 'unread' || v.state === 'reading' || v.state === 'done') &&
    typeof v.minutesSpent === 'number'
  );
}

function isThread(v: unknown): v is TutorThread {
  if (!isRecord(v)) return false;
  return typeof v.resourceId === 'string' && Array.isArray(v.messages);
}

async function listAll<T>(
  store: PluginDataStore,
  collection: StudyCollection,
  guard: (v: unknown) => v is T,
): Promise<T[]> {
  try {
    const rows = await store.list(CORE_IDENTITY, STUDY_NS, collection);
    return rows.map((r) => r.value).filter(guard);
  } catch (err) {
    // 与时段面板一致：读失败降级为空，不让工作区整体不可用
    console.error(`[study] 读取 ${collection} 失败:`, err);
    return [];
  }
}

// ---------------- 会话 ----------------

/** 全部学习会话（按开始时间倒序） */
export async function loadSessions(store: PluginDataStore): Promise<StudySession[]> {
  const sessions = await listAll(store, 'sessions', isSession);
  return sessions.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

export async function putSession(store: PluginDataStore, session: StudySession): Promise<void> {
  await store.put(CORE_IDENTITY, STUDY_NS, 'sessions', session.id, session);
}

export async function removeSession(store: PluginDataStore, id: string): Promise<void> {
  await store.remove(CORE_IDENTITY, STUDY_NS, 'sessions', id);
}

// ---------------- 笔记 ----------------

export async function loadNotes(store: PluginDataStore): Promise<StudyNote[]> {
  const notes = await listAll(store, 'notes', isNote);
  return notes.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function putNote(store: PluginDataStore, note: StudyNote): Promise<void> {
  await store.put(CORE_IDENTITY, STUDY_NS, 'notes', note.id, note);
}

export async function removeNote(store: PluginDataStore, id: string): Promise<void> {
  await store.remove(CORE_IDENTITY, STUDY_NS, 'notes', id);
}

// ---------------- 资源进度 ----------------

/** 资源进度表：`resourceId -> ResourceProgress`（键就是 resourceId，便于 O(1) 查） */
export async function loadProgress(
  store: PluginDataStore,
): Promise<Record<string, ResourceProgress>> {
  const items = await listAll(store, 'progress', isProgress);
  const out: Record<string, ResourceProgress> = {};
  for (const item of items) out[item.resourceId] = item;
  return out;
}

export async function putProgress(
  store: PluginDataStore,
  progress: ResourceProgress,
): Promise<void> {
  await store.put(CORE_IDENTITY, STUDY_NS, 'progress', progress.resourceId, progress);
}

// ---------------- 辅导对话 ----------------

export async function loadTutorThread(
  store: PluginDataStore,
  resourceId: string,
): Promise<TutorThread | null> {
  try {
    const value = await store.get(CORE_IDENTITY, STUDY_NS, 'tutor', resourceId);
    return isThread(value) ? value : null;
  } catch (err) {
    console.error('[study] 读取辅导记录失败:', err);
    return null;
  }
}

export async function putTutorThread(store: PluginDataStore, thread: TutorThread): Promise<void> {
  await store.put(CORE_IDENTITY, STUDY_NS, 'tutor', thread.resourceId, thread);
}

export async function removeTutorThread(
  store: PluginDataStore,
  resourceId: string,
): Promise<void> {
  await store.remove(CORE_IDENTITY, STUDY_NS, 'tutor', resourceId);
}

// ---------------- 汇总（进度展示 + 备份核对） ----------------

export interface StudyDataSummary {
  sessions: number;
  notes: number;
  progress: number;
  tutorThreads: number;
  /** 累计学习分钟（按会话累加） */
  minutes: number;
  /** 今天的学习分钟 */
  todayMinutes: number;
  /** 已完成阅读的资源数 */
  resourcesDone: number;
}

function todayStr(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** 工作区数据总览；同时被「今天学了多少」与「备份里有多少条」复用 */
export async function summarizeStudyData(
  store: PluginDataStore,
  now = new Date(),
): Promise<StudyDataSummary> {
  const [sessions, notes, progress, threads] = await Promise.all([
    loadSessions(store),
    loadNotes(store),
    loadProgress(store),
    listAll(store, 'tutor', isThread),
  ]);
  const today = todayStr(now);
  const progressList = Object.values(progress);

  return {
    sessions: sessions.length,
    notes: notes.length,
    progress: progressList.length,
    tutorThreads: threads.length,
    minutes: sessions.reduce((sum, s) => sum + (s.minutes || 0), 0),
    todayMinutes: sessions
      .filter((s) => s.startedAt.slice(0, 10) === today)
      .reduce((sum, s) => sum + (s.minutes || 0), 0),
    resourcesDone: progressList.filter((p) => p.state === 'done').length,
  };
}
