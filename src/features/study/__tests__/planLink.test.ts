// src/features/study/__tests__/planLink.test.ts
// 任务 -> 计划资源/证据 的还原：精确路径（回计划找同一天同一项）与兜底路径（解析描述）。
import { describe, expect, it } from 'vitest';
import {
  goalTagOf,
  isPlanTask,
  linkTaskToPlan,
  parseCitedResources,
  parsePlanProgress,
} from '../planLink';
import { aiGeneratedTag } from '../../plan-generator/services/planToTaskPayloads';
import type { GeneratedPlan } from '../../plan-generator/types';
import type { Task } from '../../../types';

const DESCRIPTION = [
  '目标：学习 Python 基础',
  '进度：第 1/3 天',
  '建议时段：09:00',
  '安排理由：先建立节奏',
  '引用资源：',
  '· [article] Python 列表推导式 — https://example.com/py',
  '· [video] 视频讲解 — https://www.bilibili.com/video/BV1',
].join('\n');

const plan: GeneratedPlan = {
  id: 'p1',
  goal: '学习 Python 基础',
  planType: 'tasks',
  userType: 'balanced',
  category: '学习',
  createdAt: '2026-09-27T00:00:00.000Z',
  engineVersion: 1,
  accepted: true,
  days: [
    {
      date: '2026-09-28',
      tasks: [{ title: '读列表推导式', estimatedMinutes: 30, category: '学习', resourceIds: ['r1'] }],
    },
  ],
  resources: [
    {
      id: 'r1',
      source: 'manual',
      layer: 3,
      type: 'article',
      title: 'Python 列表推导式',
      url: 'https://example.com/py',
    },
  ],
  evidence: [{ id: 'E1', resourceId: 'r1', chunkIndex: 0, snippet: '列表推导式把循环压成一行。' }],
};

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: '读列表推导式',
    description: DESCRIPTION,
    status: 'pending',
    priority: 1,
    created_at: '2026-09-28T00:00:00.000Z',
    tags: ['学习 Python 基础', '学习', '计划生成'],
    ...over,
  };
}

describe('planLink：描述解析', () => {
  it('解析引用资源行（类型 / 标题 / 链接）', () => {
    expect(parseCitedResources(DESCRIPTION)).toEqual([
      { type: 'article', title: 'Python 列表推导式', url: 'https://example.com/py' },
      { type: 'video', title: '视频讲解', url: 'https://www.bilibili.com/video/BV1' },
    ]);
  });

  it('解析进度行；没有进度行的任务返回 null', () => {
    expect(parsePlanProgress(DESCRIPTION)).toEqual({ day: 1, totalDays: 3 });
    expect(parsePlanProgress('目标：随便写点')).toBeNull();
    expect(parsePlanProgress(undefined)).toBeNull();
  });

  it('目标标签跳过元信息标签（计划生成 / AI 生成 / 学习工作区 / 复习）', () => {
    const task = makeTask({
      tags: ['学习 Python 基础', '学习工作区', '复习', aiGeneratedTag('qwen2.5:7b')!],
    });
    expect(goalTagOf(task)).toBe('学习 Python 基础');
    expect(goalTagOf(makeTask({ tags: ['计划生成'] }))).toBeNull();
    expect(isPlanTask(task)).toBe(false);
    expect(isPlanTask(makeTask())).toBe(true);
  });
});

describe('planLink：关联计划', () => {
  it('精确路径：同一天的同一项 -> 拿到带 id 的资源与证据', () => {
    const link = linkTaskToPlan(makeTask(), [plan]);
    expect(link.plan?.id).toBe('p1');
    expect(link.dayIndex).toBe(0);
    // 描述里引用了两条资源：只有计划里那条能对上 id（因此能拿到证据），
    // 另一条（此处是 B 站视频，计划里没有）走兜底路径构造成轻量资源，仍然可以阅读
    expect(link.resources[0].id).toBe('r1');
    expect(link.resources.map((r) => r.url)).toEqual([
      'https://example.com/py',
      'https://www.bilibili.com/video/BV1',
    ]);
    expect(link.evidence.map((e) => e.id)).toEqual(['E1']);
  });

  it('未接受的计划不会被选中', () => {
    const draft: GeneratedPlan = { ...plan, id: 'p2', accepted: false, createdAt: '2026-09-28T00:00:00.000Z' };
    const link = linkTaskToPlan(makeTask(), [draft, plan]);
    expect(link.plan?.id).toBe('p1');
  });

  it('兜底路径：计划对不上时，按描述里的链接构造资源（仍可用于阅读）', () => {
    const orphan = makeTask({ tags: ['别的目标'] });
    const link = linkTaskToPlan(orphan, [plan]);
    expect(link.plan).toBeUndefined();
    expect(link.resources.map((r) => r.url)).toEqual([
      'https://example.com/py',
      'https://www.bilibili.com/video/BV1',
    ]);
    // 对不上计划的链接会构造成"仅用于展示与阅读"的轻量资源（id 稳定可复现）
    expect(link.resources[1].id.startsWith('cited:')).toBe(true);
    expect(link.evidence).toEqual([]);
  });

  it('描述里没有引用行时返回空资源（界面据此提示"这条任务没有推荐资源"）', () => {
    const link = linkTaskToPlan(makeTask({ description: '目标：只有说明' }), [plan]);
    expect(link.resources).toEqual([]);
  });
});
