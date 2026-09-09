// src/api/scheduleStore.ts
// "时段面板"独立数据存储：面板里的每一条"时段任务"都是面板自己的实体
// （标题/时段/完成状态），与任务列表完全解耦，互不影响。
// 复用插件数据基础设施（PluginDataStore）实现双写自动回退：
//   - Tauri 环境 -> SQLite plugin_data 表；
//   - 浏览器开发 -> localStorage；
// 采用宿主保留命名空间 "__schedule"（插件清单禁止声明 __ 前缀命名空间，
// 且 core 身份拥有全部读写删权限），因此不会与任何插件数据冲突。
import type { PluginDataStore } from '../plugins/runtime';
import { timeToMinutes } from '../utils/timeSlots';

/** 面板中的一条时段任务（独立实体，与 Task 无关） */
export interface ScheduleItem {
  /** 标题 */
  title: string;
  /** 开始时间 "HH:MM" */
  start: string;
  /** 结束时间 "HH:MM"（可选） */
  end?: string;
  /** 是否已完成（面板内独立维护，不回写任务列表） */
  done?: boolean;
}

/** 某天的全部时段任务：key 为该任务的本地唯一 id */
export type DaySchedule = Record<string, ScheduleItem>;

/** 宿主保留命名空间（插件不可声明 __ 前缀） */
export const SCHEDULE_NS = '__schedule';

/** core 身份：拥有全部读写删权限 */
export const CORE_IDENTITY = 'core';

function isValidItem(v: unknown): v is ScheduleItem {
  if (!v || typeof v !== 'object') return false;
  const s = v as ScheduleItem;
  return typeof s.title === 'string' && typeof s.start === 'string' && timeToMinutes(s.start) != null;
}

/** 读取某天的全部时段任务（旧版与任务列表互通的数据因缺少 title 会被跳过） */
export async function loadDaySchedule(store: PluginDataStore, date: string): Promise<DaySchedule> {
  try {
    const records = await store.list(CORE_IDENTITY, SCHEDULE_NS, date);
    const out: DaySchedule = {};
    for (const rec of records) {
      if (isValidItem(rec.value)) out[rec.key] = rec.value;
    }
    return out;
  } catch (err) {
    console.error('[schedule] 读取时段安排失败:', err);
    return {};
  }
}

/** 写入/覆盖某条时段任务 */
export async function putScheduleItem(
  store: PluginDataStore,
  date: string,
  id: string,
  item: ScheduleItem,
): Promise<void> {
  await store.put(CORE_IDENTITY, SCHEDULE_NS, date, id, item);
}

/** 删除某条时段任务 */
export async function removeScheduleItem(
  store: PluginDataStore,
  date: string,
  id: string,
): Promise<void> {
  await store.remove(CORE_IDENTITY, SCHEDULE_NS, date, id);
}
