// src/features/plan-generator/__tests__/planQueue.test.ts
// 「计划任务逐条解锁」的纯函数测试。
// 这组用例守住的是**产品行为**：一份计划在任务栏只占一行、完成一条才放下一条，
// 以及"用户显式标记进行中的那条优先放行"这条不让人困惑的规则。
import { describe, expect, it } from 'vitest';
import {
  buildPlanQueue,
  hiddenPlanTaskIds,
  isPlanTask,
  planGroupKey,
  planQueueHints,
} from '../services/planQueue';
import { AI_TAG_PREFIX, PLAN_TAG, aiGeneratedTag } from '../services/planToTaskPayloads';
import type { Task } from '../../../types';

function makeTask(partial: Partial<Task> & { id: number; title: string }): Task {
  return {
    status: 'pending',
    priority: 2,
    created_at: '2026-09-28T00:00:00.000Z',
    is_habit: false,
    ...partial,
  };
}

const planTags = (goal: string, category = '学习') => [goal.slice(0, 12), category, PLAN_TAG];

describe('planQueue：识别与分组', () => {
  it('只有带「计划生成」标签的任务才算计划任务', () => {
    expect(isPlanTask(makeTask({ id: 1, title: 'x', tags: planTags('学习 Python') }))).toBe(true);
    expect(isPlanTask(makeTask({ id: 2, title: 'x', tags: ['工作'] }))).toBe(false);
    expect(isPlanTask(makeTask({ id: 3, title: 'x' }))).toBe(false);
  });

  it('分组键排除元信息标签（计划生成 / AI 生成）', () => {
    const task = makeTask({
      id: 1,
      title: 'x',
      tags: [...planTags('学习 Python'), aiGeneratedTag('qwen2.5:7b')!],
    });
    const key = planGroupKey(task);
    expect(key).toBe('学习 Python · 学习');
    expect(key).not.toContain(PLAN_TAG);
    expect(key).not.toContain(AI_TAG_PREFIX);
    expect(planGroupKey(makeTask({ id: 2, title: 'y', tags: ['工作'] }))).toBeNull();
  });

  it('不同目标分批互不影响', () => {
    const groups = buildPlanQueue([
      makeTask({ id: 1, title: 'a1', tags: planTags('学习 Python') }),
      makeTask({ id: 2, title: 'b1', tags: planTags('准备马拉松', '健身') }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.next)).toBe(true);
  });
});

describe('planQueue：逐条放行', () => {
  const threeDays = [
    makeTask({ id: 11, title: '第1天-1', tags: planTags('学习 Python'), due_date: '2026-09-28', priority: 1 }),
    makeTask({ id: 12, title: '第1天-2', tags: planTags('学习 Python'), due_date: '2026-09-28' }),
    makeTask({ id: 21, title: '第2天-1', tags: planTags('学习 Python'), due_date: '2026-09-29', priority: 1 }),
  ];

  it('按日期 → 优先级 → id 排序，只放行第一条', () => {
    const [group] = buildPlanQueue(threeDays);
    expect(group.next?.id).toBe(11);
    expect(group.position).toBe(1);
    expect(group.total).toBe(3);
    expect(group.done).toBe(0);
    expect(group.remaining).toBe(2);

    const hidden = hiddenPlanTaskIds([group]);
    expect([...hidden].sort()).toEqual([12, 21]);
  });

  it('完成一条后自动放行下一条（进度随之推进）', () => {
    const afterFirst = threeDays.map((t) =>
      t.id === 11 ? { ...t, status: 'completed' as const } : t,
    );
    const [group] = buildPlanQueue(afterFirst);
    expect(group.next?.id).toBe(12);
    expect(group.position).toBe(2);
    expect(group.done).toBe(1);
    expect(group.remaining).toBe(1);
    expect([...hiddenPlanTaskIds([group])]).toEqual([21]);
  });

  it('用户显式标记「进行中」的那条优先放行（尊重显式意图）', () => {
    const marked = threeDays.map((t) =>
      t.id === 21 ? { ...t, status: 'in_progress' as const } : t,
    );
    const [group] = buildPlanQueue(marked);
    expect(group.next?.id).toBe(21);
    expect(group.position).toBe(3);
    expect(group.remaining).toBe(2);
    // 顺序里的前两条被隐藏，等这条完成后再回到队列顺序
    expect([...hiddenPlanTaskIds([group])]).toEqual([11, 12]);
  });

  it('全部完成时不放行任何条目', () => {
    const allDone = threeDays.map((t) => ({ ...t, status: 'completed' as const }));
    const [group] = buildPlanQueue(allDone);
    expect(group.next).toBeUndefined();
    expect(group.done).toBe(3);
    expect(hiddenPlanTaskIds([group]).size).toBe(0);
    expect(planQueueHints([group]).size).toBe(0);
  });

  it('非计划任务不受影响（不进队列、不会被隐藏）', () => {
    const groups = buildPlanQueue([
      ...threeDays,
      makeTask({ id: 99, title: '买菜', tags: ['个人'] }),
    ]);
    const hidden = hiddenPlanTaskIds(groups);
    expect(hidden.has(99)).toBe(false);
    expect(planQueueHints(groups).has(99)).toBe(false);
  });

  it('行内进度提示带目标名、位置与剩余条数', () => {
    const hints = planQueueHints(buildPlanQueue(threeDays));
    expect(hints.get(11)).toEqual({
      label: '学习 Python',
      position: 1,
      total: 3,
      remaining: 2,
    });
  });
});
