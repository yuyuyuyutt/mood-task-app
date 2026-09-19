// src/features/plan-generator/services/habitAnalyzer.ts
// 习惯分析器：仅使用本地统计规则推断用户类型，绝不调用任何远程 API。
//
// 规则（与需求对应，按顺序短路匹配；可在 inferUserType 中扩展）：
// 1) morning_person：6-10 点完成任务占比 > 40%，且晚间活动弱（晚上完成占比 ≤ 30%）
// 2) night_owl：20-24 点完成任务占比 > 40%，且早上完成占比 < 15%
// 3) fragmented：平均任务耗时 < 30 分钟，且活动时段分散（事件/任务覆盖 ≥ 4 个不同小时）
// 4) long_focus：平均事件时长 > 90 分钟，且平均任务耗时 > 60 分钟
// 5) weekend_worker：周末与工作日的每日常量化强度相当（0.7–1.5 倍）
// 6) regular：完成率 > 90%，活跃天数 ≥ 3，且存在跨多天一致的完成时段
// 7) 否则 balanced（默认）
import type {
  EventSample,
  HabitFeatures,
  HabitProfile,
  TaskSample,
  UserType,
} from '../types';

/** 默认分析窗口（天） */
export const ANALYSIS_WINDOW_DAYS = 30;

/** 活动小时范围（含端点）：早上 6-10、晚上 20-24 */
export const MORNING_HOURS = [6, 7, 8, 9];
export const EVENING_HOURS = [20, 21, 22, 23];

// ---------------- 基础统计 ----------------

function hourOf(iso: string): number {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? -1 : d.getHours();
}

function minutesBetween(startIso: string, endIso: string): number | null {
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  if (Number.isNaN(s) || Number.isNaN(e)) return null;
  const diff = (e - s) / 60000;
  // 排除负值 / 超过 48h 的异常数据
  return diff > 0 && diff <= 48 * 60 ? diff : null;
}

function emptyHistogram(): number[] {
  return new Array<number>(24).fill(0);
}

function isWeekend(dateIso: string): boolean {
  const d = new Date(dateIso);
  const day = d.getDay();
  return day === 0 || day === 6;
}

// ---------------- 特征计算 ----------------

export function computeFeatures(
  tasks: TaskSample[],
  events: EventSample[],
  windowDays: number = ANALYSIS_WINDOW_DAYS,
): HabitFeatures {
  const cutoff = Date.now() - windowDays * 86_400_000;

  // 窗口过滤：创建或完成在窗口内的任务
  const inWindowTasks = tasks.filter((t) => {
    const created = new Date(t.createdAt).getTime();
    const completed = t.completedAt ? new Date(t.completedAt).getTime() : NaN;
    return created >= cutoff || (!Number.isNaN(completed) && completed >= cutoff);
  });

  const completedTasks = inWindowTasks.filter((t) => t.status === 'completed' && !!t.completedAt);

  // 完成时间分布
  const completionHistogram = emptyHistogram();
  const completionHours: number[] = [];
  const completionDates: string[] = [];
  const durations: number[] = [];
  let morningCount = 0;
  let eveningCount = 0;
  let weekdayCompletions = 0;
  let weekendCompletions = 0;

  for (const t of completedTasks) {
    const h = hourOf(t.completedAt as string);
    const date = (t.completedAt as string).slice(0, 10);
    if (h >= 0) {
      completionHistogram[h] += 1;
      completionHours.push(h);
      if (MORNING_HOURS.includes(h)) morningCount += 1;
      if (EVENING_HOURS.includes(h)) eveningCount += 1;
      if (!completionDates.includes(date)) completionDates.push(date);
      if (isWeekend(date)) weekendCompletions += 1;
      else weekdayCompletions += 1;
    }
    // 真实耗时（完成 - 创建），否则 actualMinutes，否则 estimatedMinutes
    const real = minutesBetween(t.createdAt, t.completedAt as string);
    const dur = real ?? t.actualMinutes ?? t.estimatedMinutes ?? null;
    if (dur != null && dur > 0) durations.push(dur);
  }

  // 事件分布
  const eventHistogram = emptyHistogram();
  const eventDurations: number[] = [];
  const eventDates: string[] = [];
  let eventSpread = 0;
  let weekdayEvents = 0;
  let weekendEvents = 0;

  for (const ev of events) {
    const h = hourOf(ev.startTime);
    const date = ev.startTime.slice(0, 10);
    if (h >= 0) {
      eventHistogram[h] += 1;
      if (!eventDates.includes(date)) eventDates.push(date);
      if (isWeekend(date)) weekendEvents += 1;
      else weekdayEvents += 1;
    }
    if (ev.endTime) {
      const dur = minutesBetween(ev.startTime, ev.endTime);
      if (dur != null) eventDurations.push(dur);
    }
  }
  eventSpread = eventHistogram.filter((c) => c > 0).length;
  const taskSpreadHours = completionHistogram.filter((c) => c > 0).length;

  // 每日主要完成时段的一致性：统计每个完成日的模式小时，多数日是否落在同一个小时
  const hourByDate = new Map<string, number[]>();
  for (const t of completedTasks) {
    const date = (t.completedAt as string).slice(0, 10);
    const h = hourOf(t.completedAt as string);
    if (h < 0) continue;
    const list = hourByDate.get(date) ?? [];
    list.push(h);
    hourByDate.set(date, list);
  }
  const perDayMode = new Map<string, number>();
  for (const [date, hours] of hourByDate) {
    const counts = new Map<number, number>();
    for (const h of hours) counts.set(h, (counts.get(h) ?? 0) + 1);
    let mode = hours[0];
    let max = 0;
    for (const [h, c] of counts) {
      if (c > max) {
        max = c;
        mode = h;
      }
    }
    perDayMode.set(date, mode);
  }
  const modeFreq = new Map<number, number>();
  for (const m of perDayMode.values()) modeFreq.set(m, (modeFreq.get(m) ?? 0) + 1);
  const distinctDays = perDayMode.size;
  const consistentTimeScore =
    distinctDays > 0 ? Math.max(...modeFreq.values()) / distinctDays : 0;

  const completedCount = completedTasks.length;
  const totalCount = inWindowTasks.length;

  const avgDuration =
    durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

  const avgEventDuration =
    eventDurations.length > 0
      ? Math.round(eventDurations.reduce((a, b) => a + b, 0) / eventDurations.length)
      : null;

  // 峰值完成小时
  let peakHour: number | null = null;
  let peakCount = 0;
  for (let h = 0; h < 24; h++) {
    if (completionHistogram[h] > peakCount) {
      peakCount = completionHistogram[h];
      peakHour = h;
    }
  }

  // 周末 vs 工作日（每日常量化强度）
  const weekdayActivity = weekdayCompletions + weekdayEvents;
  const weekendActivity = weekendCompletions + weekendEvents;
  const wdPerDay = weekdayActivity / 5;
  const wePerDay = weekendActivity / 2;
  const weekendVsWeekdayRatio =
    wdPerDay > 0 ? Math.round((wePerDay / wdPerDay) * 100) / 100 : null;

  // 任务类型分布
  const typeDist: Record<string, number> = {};
  for (const t of inWindowTasks) {
    const key = t.category || (t.tags && t.tags[0]) || '未分类';
    typeDist[key] = (typeDist[key] || 0) + 1;
  }

  return {
    totalTasks: totalCount,
    completedTasks: completedCount,
    completionRate: totalCount > 0 ? completedCount / totalCount : 0,
    avgTaskDurationMinutes: avgDuration,
    durationSamples: durations.length,
    completionHourHistogram: completionHistogram,
    eventHourHistogram: eventHistogram,
    peakCompletionHour: peakHour,
    morningRatio: completedCount > 0 ? morningCount / completedCount : 0,
    eveningRatio: completedCount > 0 ? eveningCount / completedCount : 0,
    avgEventDurationMinutes: avgEventDuration,
    eventSpreadHours: eventSpread,
    taskSpreadHours: taskSpreadHours,
    weekdayCompletions,
    weekendCompletions,
    weekdayEvents,
    weekendEvents,
    weekendVsWeekdayRatio,
    taskTypeDistribution: typeDist,
    activeDays: new Set([...completionDates, ...eventDates]).size,
    consistentTimeScore,
    consistentTimeDays: distinctDays,
  };
}

// ---------------- 类型推断 ----------------

export function inferUserType(f: HabitFeatures): UserType {
  // 样本量不足时不做激进推断（至少 3 个完成任务才判定晨型/夜猫子等）
  if (f.completedTasks >= 3) {
    // 1) 晨型
    if (f.morningRatio > 0.4 && f.eveningRatio <= 0.3) return 'morning_person';

    // 2) 夜猫子
    if (f.eveningRatio > 0.4 && f.morningRatio < 0.15) return 'night_owl';
  }

  // 3) 碎片时间利用者：任务短 + 活动时段分散
  if (
    f.avgTaskDurationMinutes != null &&
    f.avgTaskDurationMinutes < 30 &&
    (f.eventSpreadHours >= 4 || (f.eventSpreadHours === 0 && f.taskSpreadHours >= 4)) &&
    f.completedTasks >= 3
  ) {
    return 'fragmented';
  }

  // 4) 长块专注者：事件普遍 > 90 分钟且任务也长
  if (
    f.avgEventDurationMinutes != null &&
    f.avgEventDurationMinutes > 90 &&
    f.avgTaskDurationMinutes != null &&
    f.avgTaskDurationMinutes > 60 &&
    f.completedTasks >= 3
  ) {
    return 'long_focus';
  }

  // 5) 周末工作者：周末与工作日每日常量化强度相当，且数据量足够
  if (
    f.weekendVsWeekdayRatio != null &&
    f.weekendVsWeekdayRatio >= 0.7 &&
    f.weekendVsWeekdayRatio <= 1.5 &&
    f.weekdayCompletions + f.weekdayEvents >= 4 &&
    f.weekendCompletions + f.weekendEvents >= 2
  ) {
    return 'weekend_worker';
  }

  // 6) 规律执行者：完成率极高 + 活跃天数够 + 主要完成时段跨天一致
  if (
    f.completionRate > 0.9 &&
    f.completedTasks >= 5 &&
    f.activeDays >= 3 &&
    f.consistentTimeDays >= 3 &&
    f.consistentTimeScore >= 0.5
  ) {
    return 'regular';
  }

  // 7) 默认
  return 'balanced';
}

// ---------------- 对外主函数 ----------------

export function analyzeHabit(
  tasks: TaskSample[],
  events: EventSample[] = [],
  windowDays: number = ANALYSIS_WINDOW_DAYS,
): HabitProfile {
  const features = computeFeatures(tasks, events, windowDays);
  return {
    userType: inferUserType(features),
    features,
    analyzedAt: new Date().toISOString(),
    dataWindowDays: windowDays,
  };
}
