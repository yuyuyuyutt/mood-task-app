// src/components/tasks/__tests__/taskDetails.test.ts
// 展示层解析的测试：详情只留内容、来源信息迁移成标签、状态循环顺序。
import { describe, expect, it } from 'vitest';
import {
  STATUS_LABEL,
  TASK_STATUS_ORDER,
  aiTagModel,
  aiTagOf,
  formatDueDate,
  nextStatus,
  parseTaskDetails,
} from '../taskDetails';
import { AI_TAG_PREFIX, aiGeneratedTag } from '../../../features/plan-generator/services/planToTaskPayloads';
import type { Task } from '../../../types';

function makeTask(partial: Partial<Task>): Task {
  return { id: 1, title: 't', status: 'pending', priority: 2, created_at: '', is_habit: false, ...partial };
}

describe('parseTaskDetails', () => {
  it('空描述返回空正文', () => {
    expect(parseTaskDetails(undefined)).toEqual({ body: '' });
    expect(parseTaskDetails('   ')).toEqual({ body: '' });
  });

  it('丢掉来源行，保留内容行的顺序', () => {
    const parsed = parseTaskDetails(
      ['来自「个性化计划生成器」', '目标：学习 Python', '进度：第 1/6 天', '', '安排理由：先建立节奏'].join('\n'),
    );
    expect(parsed.body).toBe('目标：学习 Python\n进度：第 1/6 天\n安排理由：先建立节奏');
    expect(parsed.aiTag).toBeUndefined();
  });

  it('老数据里的 AI 标记被迁移成标签，不再留在正文里', () => {
    const parsed = parseTaskDetails(['目标：学习 Python', 'AI 润色：qwen2.5:7b', '建议：先装环境'].join('\n'));
    expect(parsed.aiTag).toBe('AI 生成 · qwen2.5:7b');
    expect(parsed.body).toBe('目标：学习 Python\n建议：先装环境');
    expect(parsed.body).not.toContain('qwen2.5:7b');
  });

  it('兼容全角冒号与「AI 生成：」写法', () => {
    expect(parseTaskDetails('AI 生成：llama3.1:8b').aiTag).toBe('AI 生成 · llama3.1:8b');
    expect(parseTaskDetails('AI润色：qwen2.5:7b').aiTag).toBe('AI 生成 · qwen2.5:7b');
    // 正文里出现 "AI" 但不是标记行时不应误伤
    const kept = parseTaskDetails('用 AI 生成一版大纲然后改写');
    expect(kept.aiTag).toBeUndefined();
    expect(kept.body).toBe('用 AI 生成一版大纲然后改写');
  });
});

describe('aiTagOf', () => {
  it('优先取 tags 里的新数据', () => {
    const tag = aiGeneratedTag('qwen2.5:7b')!;
    expect(aiTagOf(makeTask({ tags: ['学习', tag], description: 'AI 润色：旧模型' }))).toBe(tag);
  });

  it('没有标签时从描述迁移（老数据）', () => {
    expect(aiTagOf(makeTask({ description: 'AI 润色：qwen2.5:7b' }))).toBe('AI 生成 · qwen2.5:7b');
  });

  it('规则生成 / 手工任务没有 AI 标签', () => {
    expect(aiTagOf(makeTask({ tags: ['学习', '计划生成'], description: '目标：学习' }))).toBeUndefined();
  });

  it('标签里能取出模型名，供 hover 提示使用', () => {
    expect(aiTagModel(aiGeneratedTag('qwen2.5:7b')!)).toBe('qwen2.5:7b');
    expect(aiTagModel('学习')).toBe('');
  });
});

describe('formatDueDate', () => {
  const iso = (offsetDays: number) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offsetDays);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  it('近三天用相对说法，更远给具体日期', () => {
    expect(formatDueDate(iso(0))).toBe('今天');
    expect(formatDueDate(iso(1))).toBe('明天');
    expect(formatDueDate(iso(2))).toBe('后天');
    const far = formatDueDate(iso(30));
    expect(far).toMatch(/月/);
  });

  it('空值与非法值不炸', () => {
    expect(formatDueDate(undefined)).toBeNull();
    expect(formatDueDate('不是日期')).toBe('不是日期');
  });
});

describe('状态循环', () => {
  it('顺序是 暂缓 → 进行中 → 完成 → 暂缓', () => {
    expect(TASK_STATUS_ORDER).toEqual(['pending', 'in_progress', 'completed']);
    expect(nextStatus('pending')).toBe('in_progress');
    expect(nextStatus('in_progress')).toBe('completed');
    expect(nextStatus('completed')).toBe('pending');
  });

  it('状态文案与界面上的一致性（行上徽标与表单提示用同一份）', () => {
    expect(STATUS_LABEL.pending).toBe('暂缓');
    expect(STATUS_LABEL.in_progress).toBe('进行中');
    expect(STATUS_LABEL.completed).toBe('完成');
  });

  it('状态标签前缀与 AI 标签前缀一致（解析与写入共用同一常量）', () => {
    expect(AI_TAG_PREFIX).toBe('AI 生成');
  });
});
