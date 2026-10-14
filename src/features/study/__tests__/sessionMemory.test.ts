// src/features/study/__tests__/sessionMemory.test.ts
// 学习回流记忆：预估/实际偏差的可解释描述、与"计划记忆"不互相覆盖的合并键。
// 只测纯函数 —— 落库路径（IndexedDB）由 memoryStore 自己的用例覆盖。
import { describe, expect, it } from 'vitest';
import { buildStudySessionNote, describeDeviation, deviationRatio } from '../sessionMemory';
import { normalizeSubjectKey } from '../../plan-generator/services/memory/memoryWriter';

describe('sessionMemory：偏差', () => {
  it('偏差比例：实际比预估多/少；预估缺失时为 null', () => {
    expect(deviationRatio(75, 60)).toBeCloseTo(0.25, 5);
    expect(deviationRatio(45, 60)).toBeCloseTo(-0.25, 5);
    expect(deviationRatio(30, undefined)).toBeNull();
    expect(deviationRatio(30, 0)).toBeNull();
  });

  it('偏差用人话描述：10% 以内算"基本一致"', () => {
    expect(describeDeviation(null)).toBe('没有预估时长可对比');
    expect(describeDeviation(0.05)).toBe('与预估基本一致');
    expect(describeDeviation(0.25)).toBe('比预估多 25%');
    expect(describeDeviation(-0.4)).toBe('比预估少 40%');
  });
});

describe('sessionMemory：记忆条目', () => {
  const note = buildStudySessionNote({
    goal: '学习 Python 基础',
    minutes: 75,
    predictedMinutes: 60,
    sessions: 3,
    summary: '列表推导式看懂了，生成器还没吃透',
    category: '学习',
    now: new Date('2026-09-28T21:00:00Z'),
  });

  it('结论里同时有累计量、本次偏差与收工总结', () => {
    expect(note.summary).toContain('已完成 3 次学习会话');
    expect(note.summary).toContain('共 75 分钟');
    expect(note.summary).toContain('比预估多 25%');
    expect(note.summary).toContain('生成器还没吃透');
  });

  it('合并键带 study: 前缀 —— 与"计划是否被接受"那条记忆各自合并，不互相覆盖', () => {
    expect(note.subjectKey).toBe(`study:${normalizeSubjectKey('学习 Python 基础')}`);
    expect(note.subjectKey.startsWith('study:')).toBe(true);
    expect(note.kind).toBe('episodic');
    // subject 仍然是目标本身，保证它能被"按目标召回"的词面匹配命中
    expect(note.subject).toBe('学习 Python 基础');
  });

  it('量化事实可结构化检索（下次生成计划时会被召回）', () => {
    expect(note.stats).toMatchObject({
      studySessions: 3,
      studyMinutes: 75,
      predictedMinutes: 60,
    });
    expect(note.evidence.join('｜')).toContain('study:minutes:75');
    expect(note.confidence).toBeGreaterThan(0.5);
  });

  it('没有预估时不给"偏差"，置信度也低一档', () => {
    const manual = buildStudySessionNote({ goal: '看一篇文章', minutes: 20 });
    expect(manual.summary).not.toContain('预估');
    expect(manual.confidence).toBeLessThan(note.confidence);
  });
});
