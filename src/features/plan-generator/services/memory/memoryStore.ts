// src/features/plan-generator/services/memory/memoryStore.ts
// 记忆的**持久化与对外门面**（IO 层；纯逻辑在同目录 memoryWriter / memoryRetriever）。
//
// 存放位置：IndexedDB `sophotask-planner` 的 `memory` store（v3 迁移追加）。
// 之所以不新建一个 SQLite 表：记忆只在计划生成器里使用，且必须在**浏览器开发模式**下同样可用，
// 与 plans / resources 保持一致最省事，也天然被"全量数据导出"覆盖。
//
// 用户可控（隐私硬要求）：记忆可查看、可单条删除、可一键清空、可整体关闭。
import {
  KV_MEMORY_ENABLED,
  clearAllMemoryNotes,
  deleteMemoryNote,
  getAllMemoryNotes,
  kvGet,
  kvSet,
  putMemoryNote,
} from '../../db/plannerDB';
import type { MemoryHit, MemoryNote } from '../../types';
import type { RecallParams } from './memoryRetriever';
import { recallMemories } from './memoryRetriever';
import { buildMemoryNote, decayMemoryNotes, mergeMemoryNotes, type PlanMemoryInput } from './memoryWriter';

/** 记忆默认开启（可在设置页关闭；关闭后既不写入也不召回） */
export async function isMemoryEnabled(): Promise<boolean> {
  try {
    const v = await kvGet<boolean>(KV_MEMORY_ENABLED);
    return v !== false;
  } catch {
    return true;
  }
}

export async function setMemoryEnabled(enabled: boolean): Promise<void> {
  await kvSet(KV_MEMORY_ENABLED, enabled);
}

export async function listMemories(): Promise<MemoryNote[]> {
  try {
    return await getAllMemoryNotes();
  } catch (err) {
    console.warn('读取记忆失败:', err);
    return [];
  }
}

export interface RememberResult {
  note: MemoryNote | null;
  merged: boolean;
}

/**
 * 由一份计划写入一条记忆（同主题自动合并）。
 * 记忆关闭时返回 { note: null }，调用方无需自己判断开关。
 */
export async function rememberPlan(input: PlanMemoryInput): Promise<RememberResult> {
  if (!(await isMemoryEnabled())) return { note: null, merged: false };
  const incoming = buildMemoryNote(input);
  const existing = await listMemories();
  const { notes, merged } = mergeMemoryNotes(existing, incoming, input.now ?? new Date());

  if (merged) {
    const updated = notes.find((n) => n.kind === incoming.kind && n.subjectKey === incoming.subjectKey);
    if (updated) await putMemoryNote(updated);
    return { note: updated ?? incoming, merged: true };
  }
  await putMemoryNote(incoming);
  return { note: incoming, merged: false };
}

/**
 * 写入一条**已构造好的**记忆（学习会话等非计划来源复用同一套合并规则）。
 *
 * 为什么不让调用方直接 putMemoryNote：合并/关闭开关/落库三件事必须一致，
 * 否则"计划来源的记忆会合并、学习来源的记忆会堆积"这种双标迟早把记忆库搞脏。
 */
export async function rememberNote(incoming: MemoryNote, now: Date = new Date()): Promise<RememberResult> {
  if (!(await isMemoryEnabled())) return { note: null, merged: false };
  const existing = await listMemories();
  const { notes, merged } = mergeMemoryNotes(existing, incoming, now);

  if (merged) {
    const updated = notes.find((n) => n.kind === incoming.kind && n.subjectKey === incoming.subjectKey);
    if (updated) await putMemoryNote(updated);
    return { note: updated ?? incoming, merged: true };
  }
  await putMemoryNote(incoming);
  return { note: incoming, merged: false };
}

/** 生成计划前召回历史记忆；记忆关闭时直接返回空数组（静默降级） */
export async function recallForGoal(params: RecallParams): Promise<MemoryHit[]> {
  if (!(await isMemoryEnabled())) return [];
  const notes = await listMemories();
  return recallMemories(notes, params);
}

/** 记录"这些记忆确实被用到了"：命中计数与最近使用时间（影响后续排序与衰减） */
export async function markMemoriesUsed(ids: string[], now: Date = new Date()): Promise<void> {
  if (ids.length === 0) return;
  const notes = await listMemories();
  const idSet = new Set(ids);
  for (const note of notes) {
    if (!idSet.has(note.id)) continue;
    await putMemoryNote({
      ...note,
      hitCount: note.hitCount + 1,
      lastUsedAt: now.toISOString(),
    });
  }
}

export async function forgetMemory(id: string): Promise<void> {
  await deleteMemoryNote(id);
}

export async function clearMemories(): Promise<void> {
  await clearAllMemoryNotes();
}

/**
 * 衰减维护：启动时调用一次（与插件数据的 purgeExpired 同款纪律——到期才处理）。
 * 返回衰减条数与当前归档条数，UI 可以展示"已归档 N 条"。
 */
export async function decayMemories(
  now: Date = new Date(),
): Promise<{ decayed: number; archived: number }> {
  const notes = await listMemories();
  if (notes.length === 0) return { decayed: 0, archived: 0 };
  const { notes: next, decayed } = decayMemoryNotes(notes, now);
  if (decayed > 0) {
    for (const note of next) {
      const prev = notes.find((n) => n.id === note.id);
      if (prev && prev.confidence !== note.confidence) await putMemoryNote(note);
    }
  }
  const archived = next.filter((n) => n.confidence < 0.15).length;
  return { decayed, archived };
}

export interface MemoryStats {
  total: number;
  episodic: number;
  semantic: number;
  accepted: number;
  rejected: number;
  archived: number;
}

/** 记忆概览（设置页展示用） */
export function summarizeMemories(notes: MemoryNote[]): MemoryStats {
  return {
    total: notes.length,
    episodic: notes.filter((n) => n.kind === 'episodic').length,
    semantic: notes.filter((n) => n.kind === 'semantic').length,
    accepted: notes.filter((n) => n.stats?.accepted === true).length,
    rejected: notes.filter((n) => n.stats?.accepted === false).length,
    archived: notes.filter((n) => n.confidence < 0.15).length,
  };
}
