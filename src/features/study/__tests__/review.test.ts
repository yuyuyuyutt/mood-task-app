// src/features/study/__tests__/review.test.ts
// 复习安排：固定间隔序列、复习时长收敛、任务载荷与标签纪律。
import { describe, expect, it } from 'vitest';
import {
  REVIEW_INTERVALS_DAYS,
  addDays,
  buildReviewPlan,
  reviewMinutes,
  reviewTaskPayloads,
} from '../review';
import { PLAN_TAG } from '../../plan-generator/services/planToTaskPayloads';

const FROM = new Date('2026-09-28T09:30:00');

describe('review：间隔与时长', () => {
  it('四档间隔为 1 / 3 / 7 / 16 天，日期从基准日往后推', () => {
    expect(REVIEW_INTERVALS_DAYS).toEqual([1, 3, 7, 16]);
    expect(addDays(FROM, 1)).toBe('2026-09-29');
    expect(addDays(FROM, 16)).toBe('2026-10-14');
  });

  it('复习时长 = 原时长 40%，收敛到 10–60 分钟', () => {
    expect(reviewMinutes(30)).toBe(12);
    expect(reviewMinutes(5)).toBe(10); // 下限
    expect(reviewMinutes(180)).toBe(60); // 上限
    expect(reviewMinutes(undefined)).toBe(12); // 默认 30 分钟原时长
  });

  it('可以只排前几档（用户不想排满也支持）', () => {
    const plan = buildReviewPlan({ goal: '学习 Python', taskTitle: '读列表推导式', from: FROM, rounds: 2 });
    expect(plan.items).toHaveLength(2);
    expect(plan.items.map((i) => i.dueDate)).toEqual(['2026-09-29', '2026-10-01']);
  });
});

describe('review：任务载荷', () => {
  const plan = buildReviewPlan({
    goal: '学习 Python',
    taskTitle: '读列表推导式',
    minutes: 30,
    from: FROM,
  });
  const payloads = reviewTaskPayloads(plan, { category: '学习' });

  it('每条间隔生成一条待办，日期与时长对应', () => {
    expect(payloads).toHaveLength(4);
    expect(payloads[0]).toMatchObject({
      title: '复习：读列表推导式',
      due_date: '2026-09-29',
      estimated_time: 12,
      status: 'pending',
    });
    expect(payloads[3].due_date).toBe('2026-10-14');
    expect(payloads[0].priority).toBe(1); // 第一次复习优先度高一点
    expect(payloads[1].priority).toBe(2);
  });

  it('标签标出来源，但**不打计划标签**（否则会被任务栏的逐条解锁隐藏）', () => {
    expect(payloads[0].tags).toContain('学习工作区');
    expect(payloads[0].tags).toContain('复习');
    expect(payloads[0].tags).toContain('学习');
    expect(payloads[0].tags).not.toContain(PLAN_TAG);
  });

  it('描述只写内容（来源走标签），并给出复习方式建议', () => {
    const description = payloads[0].description ?? '';
    expect(description).toContain('对应内容：读列表推导式');
    expect(description).toContain('第 1/4 次复习');
    expect(description).toContain('先合上材料回忆');
  });
});
