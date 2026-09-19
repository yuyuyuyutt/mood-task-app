// src/features/plan-generator/__tests__/habitAnalyzer.test.ts
// 习惯分析逻辑单元测试（纯函数、确定性、不触网）。
import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_WINDOW_DAYS,
  analyzeHabit,
  computeFeatures,
  inferUserType,
} from '../services/habitAnalyzer';
import type { EventSample, TaskSample } from '../types';

/** 生成 n 天前某时刻的 ISO（本地时间） */
function iso(daysAgo: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function task(
  id: number,
  opts: {
    status?: 'pending' | 'completed';
    createdDaysAgo: number;
    createdHour?: number;
    completedDaysAgo?: number;
    completedHour?: number;
    estimatedMinutes?: number;
  },
): TaskSample {
  const created = new Date();
  created.setDate(created.getDate() - opts.createdDaysAgo);
  if (opts.createdHour != null) created.setHours(opts.createdHour, 0, 0, 0);
  const completed = opts.completedDaysAgo != null
    ? iso(opts.completedDaysAgo, opts.completedHour ?? 9)
    : undefined;
  return {
    id,
    title: `任务${id}`,
    status: opts.status ?? 'completed',
    createdAt: created.toISOString(),
    completedAt: completed,
    estimatedMinutes: opts.estimatedMinutes ?? null,
  };
}

function ev(id: number, daysAgo: number, startHour: number, durationMin = 60): EventSample {
  const start = new Date();
  start.setDate(start.getDate() - daysAgo);
  start.setHours(startHour, 0, 0, 0);
  const end = new Date(start.getTime() + durationMin * 60000);
  return { id, title: `事件${id}`, startTime: start.toISOString(), endTime: end.toISOString() };
}

describe('computeFeatures', () => {
  it('统计完成时段直方图 / 完成率 / 平均耗时', () => {
    const tasks: TaskSample[] = [
      task(1, { createdDaysAgo: 2, completedDaysAgo: 1, completedHour: 9, estimatedMinutes: 40 }),
      task(2, { createdDaysAgo: 2, completedDaysAgo: 1, completedHour: 9, estimatedMinutes: 20 }),
      task(3, { status: 'pending', createdDaysAgo: 0 }),
    ];
    const f = computeFeatures(tasks, [], ANALYSIS_WINDOW_DAYS);
    expect(f.totalTasks).toBe(3);
    expect(f.completedTasks).toBe(2);
    expect(f.completionRate).toBeCloseTo(2 / 3);
    expect(f.completionHourHistogram[9]).toBe(2);
    expect(f.morningRatio).toBeCloseTo(1);
    expect(f.avgTaskDurationMinutes).not.toBeNull();
  });

  it('真实耗时（完成-创建）优先于预计耗时', () => {
    // 完成时间 = 创建时间 + 15 分钟 -> 应取 15 而非 estimated 200
    const created = new Date();
    created.setDate(created.getDate() - 1);
    created.setHours(10, 0, 0, 0);
    const done = new Date(created.getTime() + 15 * 60000);
    const tasks: TaskSample[] = [
      {
        id: 1,
        title: 't',
        status: 'completed',
        createdAt: created.toISOString(),
        completedAt: done.toISOString(),
        estimatedMinutes: 200,
      },
    ];
    const f = computeFeatures(tasks, [], ANALYSIS_WINDOW_DAYS);
    expect(f.avgTaskDurationMinutes).toBe(15);
  });

  it('完成任务在窗口外的时间不参与直方图', () => {
    const t = task(99, {
      createdDaysAgo: 60,
      completedDaysAgo: 50,
      completedHour: 9,
    });
    const f = computeFeatures([t], [], ANALYSIS_WINDOW_DAYS);
    expect(f.totalTasks).toBe(0);
    expect(f.completedTasks).toBe(0);
  });
});

describe('inferUserType / analyzeHabit', () => {
  it('morning_person：早上完成占比高且晚间弱', () => {
    const tasks = [1, 2, 3, 4, 5].map((i) =>
      task(i, { createdDaysAgo: 3, completedDaysAgo: 2, completedHour: 8 + (i % 2) }),
    );
    const p = analyzeHabit(tasks, []);
    expect(p.userType).toBe('morning_person');
  });

  it('night_owl：晚间完成占比高且早上低', () => {
    const tasks = [1, 2, 3, 4, 5].map((i) =>
      task(i, { createdDaysAgo: 3, completedDaysAgo: 2, completedHour: 21 + (i % 2) }),
    );
    const p = analyzeHabit(tasks, []);
    expect(p.userType).toBe('night_owl');
  });

  it('fragmented：任务短（<30 分钟）且时段分散', () => {
    const hours = [9, 11, 14, 17];
    const tasks: TaskSample[] = hours.map((h, i) => {
      const created = new Date();
      created.setDate(created.getDate() - 2);
      created.setHours(h, 0, 0, 0);
      const done = new Date(created.getTime() + 20 * 60000); // 20 分钟后完成
      return {
        id: i + 1,
        title: `任务${i + 1}`,
        status: 'completed',
        createdAt: created.toISOString(),
        completedAt: done.toISOString(),
        estimatedMinutes: 20,
      };
    });
    const p = analyzeHabit(tasks, []);
    expect(p.userType).toBe('fragmented');
  });

  it('long_focus：事件普遍 >90 分钟且任务也长', () => {
    const events = [ev(1, 1, 9, 120), ev(2, 1, 14, 100), ev(3, 2, 10, 120)];
    const tasks = [1, 2, 3].map((i) =>
      task(i, { createdDaysAgo: 4, completedDaysAgo: 3, completedHour: 10 + i, estimatedMinutes: 90 }),
    );
    const p = analyzeHabit(tasks, events);
    expect(p.userType).toBe('long_focus');
  });

  it('weekend_worker：周末与工作日每日常量强度相当', () => {
    const tasks: TaskSample[] = [];
    // 5 个工作日 x2 + 2 个周末日 x2 => 周末/工作日都是 2 项每天（2/day vs 2/day）
    for (const offset of nextWeekdayOffsets(5)) {
      tasks.push(task(tasks.length + 1, { createdDaysAgo: offset + 1, completedDaysAgo: offset, completedHour: 13 }));
      tasks.push(task(tasks.length + 1, { createdDaysAgo: offset + 1, completedDaysAgo: offset, completedHour: 15 }));
    }
    for (const offset of nextWeekendOffsets()) {
      tasks.push(task(tasks.length + 1, { createdDaysAgo: offset + 1, completedDaysAgo: offset, completedHour: 13 }));
      tasks.push(task(tasks.length + 1, { createdDaysAgo: offset + 1, completedDaysAgo: offset, completedHour: 15 }));
    }
    // 加点未完成任务压低完成率，避免命中 regular
    for (let i = 0; i < 8; i++) {
      tasks.push(task(1000 + i, { status: 'pending', createdDaysAgo: 1 }));
    }
    const p = analyzeHabit(tasks, []);
    expect(p.userType).toBe('weekend_worker');
  });

  it('regular：完成率高且完成时段跨天稳定', () => {
    // 连续 5 个工作日，每天 13 点完成 2 个任务（避开 6-10 / 20-24 时段规则与周末规则）
    const offsets = nextWeekdayOffsets(5);
    const tasks: TaskSample[] = [];
    for (const d of offsets) {
      tasks.push(task(tasks.length + 1, { createdDaysAgo: d + 1, completedDaysAgo: d, completedHour: 13, estimatedMinutes: 60 }));
      tasks.push(task(tasks.length + 1, { createdDaysAgo: d + 1, completedDaysAgo: d, completedHour: 13, estimatedMinutes: 60 }));
    }
    const p = analyzeHabit(tasks, []);
    expect(p.userType).toBe('regular');
  });

  it('无数据时回退到 balanced', () => {
    const p = analyzeHabit([], []);
    expect(p.userType).toBe('balanced');
    expect(p.features.totalTasks).toBe(0);
    expect(p.features.completionRate).toBe(0);
  });

  it('数据不足（1 条）时回退到 balanced', () => {
    const p = analyzeHabit([task(1, { createdDaysAgo: 1, completedDaysAgo: 1, completedHour: 8 })], []);
    expect(p.userType).toBe('balanced');
  });
});

/** 计算接下来两个周末日（与今天偏移的天数） */
function nextWeekendOffsets(): number[] {
  const out: number[] = [];
  let offset = 1;
  while (out.length < 2) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const day = d.getDay();
    if (day === 0 || day === 6) out.push(offset);
    offset++;
  }
  return out;
}

/** 计算接下来 n 个工作日（与今天偏移的天数） */
function nextWeekdayOffsets(n: number): number[] {
  const out: number[] = [];
  let offset = 1;
  while (out.length < n) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const day = d.getDay();
    if (day >= 1 && day <= 5) out.push(offset);
    offset++;
  }
  return out;
}

// 类型层面：inferUserType 可直接调用
describe('inferUserType export', () => {
  it('可直接对特征调用', () => {
    const f = computeFeatures([], [], ANALYSIS_WINDOW_DAYS);
    expect(typeof inferUserType(f)).toBe('string');
  });
});
