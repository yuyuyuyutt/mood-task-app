// src/components/tasks/__tests__/TaskCompactRow.render.test.tsx
// 任务行的**渲染冒烟测试**。
//
// 为什么用 renderToStaticMarkup 而不是 jsdom + testing-library：
// 本仓库刻意没有引入 jsdom（见 docs/DEV-GUIDE.md 第 6 节），组件逻辑都已抽成纯函数单独测试。
// 这里只做一件纯函数覆盖不到的事：确认"行上真的渲染出了状态徽标 / AI 生成徽标"，
// 也就是守住本次四项交互改动的**可见结论**（徽标常驻、AI 生成走标签、状态文案一致）。
import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TaskCompactRow } from '../TaskCompactRow';
import { aiGeneratedTag } from '../../../features/plan-generator/services/planToTaskPayloads';
import type { Task } from '../../../types';

const noop = () => undefined;

function render(task: Task, overrides: Partial<React.ComponentProps<typeof TaskCompactRow>> = {}) {
  return renderToStaticMarkup(
    <TaskCompactRow
      task={task}
      onComplete={noop}
      onDelete={noop}
      onEdit={noop}
      onMarkHabitComplete={noop}
      onStatusChange={noop}
      {...overrides}
    />,
  );
}

function makeTask(partial: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: '学习列表推导式',
    status: 'pending',
    priority: 2,
    created_at: '2026-09-28T00:00:00.000Z',
    is_habit: false,
    ...partial,
  };
}

describe('TaskCompactRow 渲染', () => {
  it('计划 + AI 生成的任务：行上同时出现 AI 生成徽标与状态徽标', () => {
    const html = render(
      makeTask({
        tags: ['学习 Python', '学习', '计划生成', aiGeneratedTag('qwen2.5:7b')!],
        description: '目标：学习 Python\n进度：第 1/6 天',
        estimated_time: 30,
        due_date: '2026-09-28',
      }),
    );
    expect(html).toContain('AI 生成 · qwen2.5:7b'); // 来源信息在标签里，不在详情里
    expect(html).toContain('暂缓'); // 状态常驻可见
    expect(html).toContain('30m');
    expect(html).not.toContain('目标：学习 Python'); // 详情不在行内，改由悬浮卡承载
  });

  it('状态徽标按状态显示不同文案（进行中）', () => {
    const html = render(makeTask({ status: 'in_progress' }));
    expect(html).toContain('进行中');
    expect(html).not.toContain('暂缓');
  });

  it('习惯任务不显示状态徽标（它有自己的一套周期与今日完成）', () => {
    const html = render(
      makeTask({ is_habit: true, habit_period: 'weekdays', habit_completions: [] }),
    );
    expect(html).toContain('工作日');
    expect(html).not.toContain('暂缓');
  });

  it('没有 AI 标签的任务不显示 AI 徽标（规则生成 / 手工创建）', () => {
    const html = render(makeTask({ tags: ['工作', '计划生成'] }));
    expect(html).not.toContain('AI 生成');
  });
});
