// src/utils/timeSlots.ts
// 一天的时间段（时段带）定义与时间换算工具。
// 面板按"时段带"组织任务；任务同时可带自定义开始/结束时间（HH:MM），
// 并按开始时间归入对应时段带、在带内排序。

export type TimeBandId = 'dawn' | 'morning' | 'noon' | 'afternoon' | 'evening' | 'night';

export interface TimeBand {
  id: TimeBandId;
  label: string;
  /** 时段带默认开始时间（快速新建任务时使用） */
  startLabel: string;
  endLabel: string;
  /** 分钟数（0-1440），用于归属与排序 */
  startMin: number;
  endMin: number;
}

export const TIME_BANDS: TimeBand[] = [
  { id: 'dawn', label: '清晨', startLabel: '05:00', endLabel: '08:00', startMin: 5 * 60, endMin: 8 * 60 },
  { id: 'morning', label: '上午', startLabel: '08:00', endLabel: '12:00', startMin: 8 * 60, endMin: 12 * 60 },
  { id: 'noon', label: '中午', startLabel: '12:00', endLabel: '14:00', startMin: 12 * 60, endMin: 14 * 60 },
  { id: 'afternoon', label: '下午', startLabel: '14:00', endLabel: '18:00', startMin: 14 * 60, endMin: 18 * 60 },
  { id: 'evening', label: '晚上', startLabel: '18:00', endLabel: '22:00', startMin: 18 * 60, endMin: 22 * 60 },
  { id: 'night', label: '深夜', startLabel: '22:00', endLabel: '24:00', startMin: 22 * 60, endMin: 24 * 60 },
];

export function bandById(id: TimeBandId): TimeBand {
  return TIME_BANDS.find((b) => b.id === id) ?? TIME_BANDS[0];
}

/** "HH:MM" -> 分钟数（0-1439）；非法输入返回 null */
export function timeToMinutes(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

/** 分钟数 -> "HH:MM"（1440 -> "24:00" 保留给深夜结束） */
export function minutesToTime(min: number): string {
  const clamped = Math.max(0, Math.min(1440, min));
  if (clamped === 1440) return '24:00';
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 分钟数归属的时段带（<05:00 归入清晨前的深夜带，>22:00 归深夜） */
export function bandForMinutes(min: number): TimeBand {
  for (const b of TIME_BANDS) {
    if (min >= b.startMin && min < b.endMin) return b;
  }
  return TIME_BANDS[TIME_BANDS.length - 1];
}

/** 拖动条吸附：把分钟吸附到 5 的整数倍（即 0/5 结尾），并夹在 0..1440 */
export function snapToFiveMinutes(min: number): number {
  const clamped = Math.max(0, Math.min(1440, min));
  return Math.round(clamped / 5) * 5;
}

// ---------------- 日期工具（本地时区，避免 toISOString 偏移） ----------------

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 本地日期 "YYYY-MM-DD" */
export function dateToStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayStr(): string {
  return dateToStr(new Date());
}

/** 字符串日期加减天数 */
export function addDaysStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return dateToStr(dt);
}

/** 字符串日期所在周的周一（YYYY-MM-DD） */
export function weekStartStr(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = (dt.getDay() + 6) % 7; // 周一=0
  dt.setDate(dt.getDate() - dow);
  return dateToStr(dt);
}

const WEEKDAY_CN = ['一', '二', '三', '四', '五', '六', '日'];

/** 友好中文日期，如 "1月15日 周三" */
export function formatDateCn(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${m}月${d}日 周${WEEKDAY_CN[(dt.getDay() + 6) % 7]}`;
}
