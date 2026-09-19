// src/features/plan-generator/__tests__/planToTaskPayloads.test.ts
// 计划 -> 数据库任务载荷 的纯函数测试（验证"按具体日期生成真实任务"的映射规则）。
import { describe, expect, it } from 'vitest';
import { PLAN_TAG, planToTaskPayloads } from '../services/planToTaskPayloads';
import { generatePlan } from '../services/planGenerator';
import type { GeneratedPlan } from '../types';

const NOW = new Date('2025-04-01T10:00:00');

function makePlan(planType: 'tasks' | 'events', days = 3): GeneratedPlan {
  return generatePlan(
    { goal: '学习 Python', days, planType, userType: 'balanced' },
    { now: NOW, id: 'plan-x' },
  );
}

describe('planToTaskPayloads', () => {
  it('每个计划项生成一条任务，due_date 等于计划中的具体日期', () => {
    const plan = makePlan('tasks', 3);
    const payloads = planToTaskPayloads(plan);

    const expectedCount = plan.days.reduce((s, d) => s + (d.tasks?.length ?? 0), 0);
    expect(payloads.length).toBe(expectedCount);

    // 逐日核对：第 i 天的任务 due_date 必须等于该天日期，且顺序一致
    let cursor = 0;
    plan.days.forEach((day) => {
      (day.tasks ?? []).forEach((t) => {
        const p = payloads[cursor++];
        expect(p.due_date).toBe(day.date);
        expect(p.title).toBe(t.title);
        expect(p.estimated_time).toBe(t.estimatedMinutes);
      });
    });
  });

  it('每天首项 priority=1，其余为 2；状态为 pending', () => {
    const plan = makePlan('tasks', 2);
    const payloads = planToTaskPayloads(plan);
    let idx = 0;
    plan.days.forEach((day) => {
      (day.tasks ?? []).forEach((_, i) => {
        expect(payloads[idx].priority).toBe(i === 0 ? 1 : 2);
        expect(payloads[idx].status).toBe('pending');
        idx++;
      });
    });
  });

  it('写入标签与描述便于识别来源', () => {
    const plan = makePlan('tasks', 1);
    const [first] = planToTaskPayloads(plan);
    expect(first.tags).toContain(PLAN_TAG);
    expect(first.tags).toContain('学习');
    expect(first.description).toContain('学习 Python');
    expect(first.description).toContain('第 1/1 天');
  });

  it('事件形态：时长与日期同样落库', () => {
    const plan = makePlan('events', 2);
    const payloads = planToTaskPayloads(plan);
    const expectedCount = plan.days.reduce((s, d) => s + (d.events?.length ?? 0), 0);
    expect(payloads.length).toBe(expectedCount);

    const firstEvent = plan.days[0].events![0];
    expect(payloads[0].due_date).toBe(plan.days[0].date);
    expect(payloads[0].estimated_time).toBeGreaterThanOrEqual(10);
    expect(payloads[0].description).toContain(`${firstEvent.startTime}-${firstEvent.endTime}`);
  });

  it('AI 润色信息写入描述（模型名/建议）', () => {
    const plan: GeneratedPlan = {
      ...makePlan('tasks', 1),
      llmModel: 'qwen2.5:7b',
      aiNarrative: '先把环境装好，再每天推进一节。',
    };
    const [first] = planToTaskPayloads(plan);
    expect(first.description).toContain('qwen2.5:7b');
    expect(first.description).toContain('先把环境装好');
  });

  it('limitPerDay 可限制每天写入条数', () => {
    const plan = makePlan('tasks', 2);
    const limited = planToTaskPayloads(plan, { limitPerDay: 1 });
    expect(limited.length).toBe(2);
    expect(new Set(limited.map((p) => p.due_date)).size).toBe(2);
  });
});
