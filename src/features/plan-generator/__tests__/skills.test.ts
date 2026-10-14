// src/features/plan-generator/__tests__/skills.test.ts
// Skill 体系的咽喉测试：白名单、权限门、参数校验、写操作确认闸门、diff 正确性。
// 这些分支每一条都是安全边界，必须有用例兜住。
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { builtinRegistry } from '../services/agent/tools/builtin';
import { CONFIRM_TTL_MS, SkillGate } from '../services/agent/tools/gate';
import { SkillRegistry, defineSkill } from '../services/agent/tools/registry';
import {
  addDays,
  fitMinutesToTarget,
  summarizePlanForPrompt,
} from '../services/agent/tools/builtin';
import type { SkillContext, SkillScope } from '../services/agent/tools/types';
import type { GeneratedPlan } from '../types';

const ALL_SCOPES: SkillScope[] = [
  'plan:read',
  'plan:write',
  'task:write',
  'memory:read',
  'memory:write',
  'resource:read',
];

function fixturePlan(): GeneratedPlan {
  return {
    id: 'p1',
    goal: '学习 Python 基础',
    planType: 'tasks',
    userType: 'balanced',
    category: '学习',
    createdAt: '2026-09-28T00:00:00.000Z',
    engineVersion: 1,
    accepted: false,
    days: [
      {
        date: '2026-09-28',
        tasks: [
          { title: '装好环境', category: '学习', estimatedMinutes: 30 },
          { title: '练语法', category: '学习', estimatedMinutes: 45 },
        ],
      },
      {
        date: '2026-09-29',
        tasks: [{ title: '写脚本', category: '学习', estimatedMinutes: 60 }],
      },
      {
        date: '2026-09-30',
        tasks: [
          { title: '做小项目', category: '学习', estimatedMinutes: 90 },
          { title: '复盘', category: '学习', estimatedMinutes: 20 },
        ],
      },
    ],
    resources: [{ id: 'bilibili:abc', source: 'bilibili', layer: 1, type: 'video', title: 'Python 入门', url: 'https://example.com' }],
    strategy: { methodology: ['间隔重复'], risks: ['贪多求快', '缺少反馈'], successCriteria: ['连续 7 天'] },
  };
}

function makeGate(plan: GeneratedPlan | null, scopes: SkillScope[] = ALL_SCOPES): SkillGate {
  const ctx: SkillContext = { scopes, plan, now: new Date('2026-09-28T00:00:00.000Z') };
  return new SkillGate(ctx, builtinRegistry);
}

describe('内置工具注册表', () => {
  it('注册了只读工具与写工具，且写工具在 prompt 里被标注"需用户确认"', () => {
    const names = builtinRegistry.list().map((s) => s.name);
    expect(names).toContain('get_plan_summary');
    expect(names).toContain('recall_memory');
    expect(names).toContain('shift_plan_days');
    expect(names).toContain('compress_daily_minutes');
    expect(names).toContain('remove_task');
    expect(names).toContain('rename_task');
    expect(names).toContain('move_task_to_day');
    expect(builtinRegistry.list().filter((s) => s.sideEffect === 'write')).toHaveLength(5);

    const lines = builtinRegistry.describeForPrompt();
    expect(lines.some((l) => l.startsWith('- shift_plan_days（写操作，需用户确认）'))).toBe(true);
    expect(lines.some((l) => l.includes('get_plan_summary（只读）'))).toBe(true);
  });

  it('重复注册同名工具会抛错（白名单必须无歧义）', () => {
    const registry = new SkillRegistry();
    const skill = builtinRegistry.get('get_plan_summary');
    expect(skill).toBeDefined();
    registry.register(skill!);
    expect(() => registry.register(skill!)).toThrow('工具重复注册');
  });

  it('按 scope 过滤可见工具：只有 plan:read 时看不到写工具', () => {
    const gate = makeGate(fixturePlan(), ['plan:read']);
    const visible = gate.listVisible().map((s) => s.name);
    expect(visible).toContain('get_plan_summary');
    expect(visible).not.toContain('shift_plan_days');
  });
});

describe('权限门（白名单 / scope / 参数校验）', () => {
  it('白名单外的工具名一律拒绝', async () => {
    const gate = makeGate(fixturePlan());
    const res = await gate.dispatch('delete_everything', {});
    expect(res.status).toBe('rejected');
    if (res.status === 'rejected') expect(res.reason).toContain('未注册的工具');
  });

  it('缺少声明权限时拒绝执行', async () => {
    const gate = makeGate(fixturePlan(), ['plan:read']);
    const res = await gate.dispatch('shift_plan_days', { days: 2 });
    expect(res.status).toBe('rejected');
    if (res.status === 'rejected') expect(res.reason).toContain('缺少权限范围');
  });

  it('参数校验不通过时拒绝（类型错、越界都拦得住）', async () => {
    const gate = makeGate(fixturePlan());
    const bad = await gate.dispatch('shift_plan_days', { days: 0 });
    expect(bad.status).toBe('rejected');
    if (bad.status === 'rejected') expect(bad.reason).toContain('参数校验未通过');

    const worse = await gate.dispatch('shift_plan_days', { days: '两天' });
    expect(worse.status).toBe('rejected');

    const outOfRange = await gate.dispatch('move_task_to_day', { day: 1, item: 1, toDay: 99 });
    expect(outOfRange.status).toBe('rejected');
    if (outOfRange.status === 'rejected') expect(outOfRange.reason).toContain('超出范围');
  });

  it('没有计划时读工具报错而不是崩掉', async () => {
    const gate = makeGate(null);
    const res = await gate.dispatch('get_plan_summary', {});
    expect(res.status).toBe('rejected');
    if (res.status === 'rejected') expect(res.reason).toContain('没有可用的计划');
  });

  it('写工具缺少变更预览时按安全默认值拒绝执行', async () => {
    const silentWrite = defineSkill<Record<string, never>, Record<string, never>>({
      name: 'silent_write',
      title: '无预览的写工具',
      description: '故意不提供 preview，用于验证闸门的安全默认值',
      scopes: ['plan:write'],
      sideEffect: 'write',
      paramsHint: '{}',
      schema: z.object({}),
      execute: async () => ({}),
    });
    const registry = new SkillRegistry().register(silentWrite);
    const gate = new SkillGate({ scopes: ALL_SCOPES, plan: fixturePlan() }, registry);
    const res = await gate.dispatch('silent_write', {});
    expect(res.status).toBe('rejected');
    if (res.status === 'rejected') expect(res.reason).toContain('未提供变更预览');
  });
});

describe('只读工具', () => {
  it('get_plan_summary 产出可读摘要（含日期与项数）', async () => {
    const gate = makeGate(fixturePlan());
    const res = await gate.dispatch('get_plan_summary', {});
    expect(res.status).toBe('ok');
    if (res.status === 'ok') {
      const out = res.output as { text: string; days: number; items: number };
      expect(out.days).toBe(3);
      expect(out.items).toBe(5);
      expect(out.text).toContain('学习 Python 基础');
      expect(out.text).toContain('2026-09-28');
    }
  });

  it('recall_memory 在无存储环境下静默降级为空（不阻塞调整流程）', async () => {
    const gate = makeGate(fixturePlan());
    const res = await gate.dispatch('recall_memory', { limit: 2 });
    expect(res.status).toBe('ok');
    if (res.status === 'ok') expect((res.output as { hits: unknown[] }).hits).toEqual([]);
  });

  it('summarizePlanForPrompt 可脱敏标题（用于只给模型看结构）', () => {
    const text = summarizePlanForPrompt(fixturePlan(), false);
    expect(text).toContain('(略)');
    expect(text).not.toContain('装好环境');
  });
});

describe('写工具：干跑 → 确认 → 提交', () => {
  it('顺延：干跑不产生副作用，commit 后日期整体 +2 天', async () => {
    const plan = fixturePlan();
    const gate = makeGate(plan);

    const pending = await gate.dispatch('shift_plan_days', { days: 2 });
    expect(pending.status).toBe('needs_confirmation');
    if (pending.status !== 'needs_confirmation') return;

    // 干跑阶段原计划必须原封不动
    expect(plan.days.map((d) => d.date)).toEqual(['2026-09-28', '2026-09-29', '2026-09-30']);
    expect(pending.summary).toContain('顺延 2 天');
    expect(pending.diff.changes).toHaveLength(3);

    const committed = await gate.commit(pending.token);
    expect(committed.status).toBe('ok');
    if (committed.status !== 'ok' || !committed.diff) return;

    const next = committed.diff.apply(plan);
    expect(next.days.map((d) => d.date)).toEqual(['2026-09-30', '2026-10-01', '2026-10-02']);
    expect(next.days[0]).not.toBe(plan.days[0]); // 纯函数：不原地修改
  });

  it('令牌是一次性的：重复 commit 被拒绝', async () => {
    const gate = makeGate(fixturePlan());
    const pending = await gate.dispatch('shift_plan_days', { days: 1 });
    if (pending.status !== 'needs_confirmation') throw new Error('应进入待确认状态');

    expect((await gate.commit(pending.token)).status).toBe('ok');
    const second = await gate.commit(pending.token);
    expect(second.status).toBe('rejected');
    if (second.status === 'rejected') expect(second.reason).toContain('无效或已被使用');
  });

  it('确认令牌会过期（避免几个小时前的确认被悄悄提交）', async () => {
    const gate = makeGate(fixturePlan());
    const pending = await gate.dispatch('shift_plan_days', { days: 1 });
    if (pending.status !== 'needs_confirmation') throw new Error('应进入待确认状态');

    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + CONFIRM_TTL_MS + 1);
    const res = await gate.commit(pending.token);
    expect(res.status).toBe('rejected');
    if (res.status === 'rejected') expect(res.reason).toContain('已过期');
  });

  it('取消后令牌立即失效', async () => {
    const gate = makeGate(fixturePlan());
    const pending = await gate.dispatch('shift_plan_days', { days: 1 });
    if (pending.status !== 'needs_confirmation') throw new Error('应进入待确认状态');

    gate.discard(pending.token);
    expect(gate.pendingCount).toBe(0);
    expect((await gate.commit(pending.token)).status).toBe('rejected');
  });

  it('压缩：dry-run 展示 before→after，apply 后每天不超过目标', async () => {
    const plan = fixturePlan();
    const gate = makeGate(plan);
    const pending = await gate.dispatch('compress_daily_minutes', { minutes: 40 });
    expect(pending.status).toBe('needs_confirmation');
    if (pending.status !== 'needs_confirmation') return;

    const next = pending.diff.apply(plan);
    for (const day of next.days) {
      const total = (day.tasks ?? []).reduce((s, t) => s + t.estimatedMinutes, 0);
      expect(total).toBeLessThanOrEqual(40);
      for (const t of day.tasks ?? []) expect(t.estimatedMinutes).toBeGreaterThanOrEqual(10);
    }
    expect(pending.diff.changes[0].detail).toMatch(/分钟 → \d+ 分钟/);
  });

  it('删除：apply 后当天少一项；当天只剩一项时拒绝', async () => {
    const plan = fixturePlan();
    const gate = makeGate(plan);
    const pending = await gate.dispatch('remove_task', { day: 1, item: 2 });
    expect(pending.status).toBe('needs_confirmation');
    if (pending.status === 'needs_confirmation') {
      const next = pending.diff.apply(plan);
      expect(next.days[0].tasks).toHaveLength(1);
      expect(next.days[0].tasks?.[0].title).toBe('装好环境');
    }

    const lonely = await gate.dispatch('remove_task', { day: 2, item: 1 });
    expect(lonely.status).toBe('rejected');
    if (lonely.status === 'rejected') expect(lonely.reason).toContain('当天会变空');
  });

  it('改写与移动：apply 的语义与预览一致', async () => {
    const plan = fixturePlan();
    const gate = makeGate(plan);

    const renamed = await gate.dispatch('rename_task', { day: 1, item: 1, title: '装好 Python 环境' });
    expect(renamed.status).toBe('needs_confirmation');
    if (renamed.status === 'needs_confirmation') {
      const next = renamed.diff.apply(plan);
      expect(next.days[0].tasks?.[0].title).toBe('装好 Python 环境');
    }

    const moved = await gate.dispatch('move_task_to_day', { day: 1, item: 1, toDay: 3 });
    expect(moved.status).toBe('needs_confirmation');
    if (moved.status === 'needs_confirmation') {
      const next = moved.diff.apply(plan);
      expect(next.days[0].tasks).toHaveLength(1);
      expect(next.days[2].tasks).toHaveLength(3);
      expect(next.days[2].tasks?.some((t) => t.title === '装好环境')).toBe(true);
    }
  });

  it('没有实际变化的调整会被拒绝（不产生噪音 diff）', async () => {
    const gate = makeGate(fixturePlan());
    expect((await gate.dispatch('rename_task', { day: 1, item: 1, title: '装好环境' })).status).toBe('rejected');
    expect((await gate.dispatch('compress_daily_minutes', { minutes: 240 })).status).toBe('rejected');
    expect((await gate.dispatch('move_task_to_day', { day: 1, item: 1, toDay: 1 })).status).toBe('rejected');
  });
});

describe('纯函数工具（可直接单测，不需要模型）', () => {
  it('addDays 跨月跨年正确', () => {
    expect(addDays('2026-09-28', 2)).toBe('2026-09-30');
    expect(addDays('2026-09-30', 2)).toBe('2026-10-02');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('fitMinutesToTarget 优先削最长项且守住 10 分钟下限', () => {
    // 每轮削当前最长项 5 分钟，因此两项交替下降，最终和恰好落到 40
    expect(fitMinutesToTarget([30, 45], 40)).toEqual([20, 20]);
    // 三项都已经到 10 分钟下限（共 30）却还要压到 20：不做无意义的循环，返回可达结果
    expect(fitMinutesToTarget([10, 10, 10], 20)).toEqual([10, 10, 10]);
    expect(fitMinutesToTarget([30, 45], 40).reduce((s, v) => s + v, 0)).toBeLessThanOrEqual(40);
  });
});
