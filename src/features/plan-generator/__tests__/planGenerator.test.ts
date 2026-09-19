// src/features/plan-generator/__tests__/planGenerator.test.ts
import { describe, expect, it } from 'vitest';
import {
  generatePlan,
  isEventsSorted,
  summarizePlan,
} from '../services/planGenerator';
import { toMinutes } from '../services/templates';
import type { GeneratedPlan } from '../types';

const NOW = new Date('2025-04-01T10:00:00'); // 周二

function makePlan(opts: Partial<Parameters<typeof generatePlan>[0]> = {}): GeneratedPlan {
  return generatePlan(
    {
      goal: '学习 Python',
      days: 5,
      planType: 'tasks',
      userType: 'balanced',
      ...opts,
    },
    { now: NOW, id: 'test-plan' },
  );
}

function dayDates(plan: GeneratedPlan): string[] {
  return plan.days.map((d) => d.date);
}

describe('generatePlan 基础', () => {
  it('生成任务列表计划：天数正确且每天有任务', () => {
    const p = makePlan({ days: 7, planType: 'tasks', userType: 'balanced' });
    expect(p.days.length).toBe(7);
    for (const day of p.days) {
      expect(day.tasks && day.tasks.length).toBeGreaterThan(0);
      expect(day.events).toBeUndefined();
    }
  });

  it('生成事件时段表：每天有事件且不重叠、顺序有序', () => {
    const p = makePlan({ days: 5, planType: 'events', userType: 'balanced' });
    expect(p.days.length).toBe(5);
    expect(isEventsSorted(p)).toBe(true);
    for (const day of p.days) {
      expect(day.events && day.events.length).toBeGreaterThan(0);
      for (const ev of day.events!) {
        expect(toMinutes(ev.startTime)).toBeLessThan(toMinutes(ev.endTime));
      }
    }
  });

  it('每天总投入等于该类目默认分钟数（学习 90）', () => {
    const p = makePlan({ days: 4, planType: 'tasks', userType: 'balanced' });
    for (const day of p.days) {
      const sum = day.tasks!.reduce((s, t) => s + t.estimatedMinutes, 0);
      expect(sum).toBe(90);
    }
    expect(summarizePlan(p).totalMinutes).toBe(360);
  });

  it('按目标文本识别类别（Python -> 学习）', () => {
    const p = makePlan({ goal: '学习 Python 爬虫' });
    expect(p.category).toBe('学习');
  });
});

describe('用户类型影响时段安排', () => {
  it('morning_person：任务安排在 8:00–10:00', () => {
    const p = makePlan({ planType: 'tasks', userType: 'morning_person' });
    for (const day of p.days) {
      for (const t of day.tasks!) {
        const start = toMinutes(t.bestTime!.slice(0, 5));
        const end = toMinutes(t.bestTime!.slice(6));
        expect(start).toBeGreaterThanOrEqual(8 * 60);
        expect(end).toBeLessThanOrEqual(10 * 60);
      }
    }
  });

  it('night_owl：任务安排在 20:00–22:00', () => {
    const p = makePlan({ planType: 'tasks', userType: 'night_owl' });
    for (const day of p.days) {
      for (const t of day.tasks!) {
        expect(toMinutes(t.bestTime!.slice(0, 5))).toBeGreaterThanOrEqual(20 * 60);
      }
    }
  });

  it('fragmented：拆成 ≤30 分钟的小任务且每天多于 2 个', () => {
    const p = makePlan({ planType: 'tasks', userType: 'fragmented', days: 3 });
    for (const day of p.days) {
      expect(day.tasks!.length).toBeGreaterThanOrEqual(3);
      for (const t of day.tasks!) expect(t.estimatedMinutes).toBeLessThanOrEqual(30);
    }
  });

  it('long_focus：事件为 1–2 个长时段', () => {
    const p = makePlan({ planType: 'events', userType: 'long_focus', days: 3 });
    for (const day of p.days) {
      expect(day.events!.length).toBeLessThanOrEqual(2);
    }
  });
});

describe('可用时段 / 周末约束', () => {
  it('事件不超出用户可用时段', () => {
    const p = makePlan({
      planType: 'events',
      userType: 'balanced',
      preferences: { availability: { start: '09:00', end: '12:00' } },
    });
    for (const day of p.days) {
      for (const ev of day.events!) {
        expect(toMinutes(ev.startTime)).toBeGreaterThanOrEqual(9 * 60);
        expect(toMinutes(ev.endTime)).toBeLessThanOrEqual(12 * 60);
      }
    }
  });

  it('includeWeekend=false 时日期不落在周末', () => {
    const p = makePlan({
      days: 10,
      preferences: { includeWeekend: false },
    });
    for (const d of dayDates(p)) {
      const dow = new Date(d + 'T00:00:00').getDay();
      expect(dow).not.toBe(0);
      expect(dow).not.toBe(6);
    }
    expect(p.days.length).toBe(10);
  });

  it('确定性：相同输入产出相同计划', () => {
    const a = makePlan({ goal: '背单词', days: 3, planType: 'tasks', userType: 'fragmented' });
    const b = makePlan({ goal: '背单词', days: 3, planType: 'tasks', userType: 'fragmented' });
    expect(JSON.stringify(a.days)).toBe(JSON.stringify(b.days));
  });
});
