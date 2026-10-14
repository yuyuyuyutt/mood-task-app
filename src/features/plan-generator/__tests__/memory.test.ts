// src/features/plan-generator/__tests__/memory.test.ts
// 记忆的写入 / 合并 / 衰减 / 召回（纯逻辑，不依赖 IndexedDB）。
import { describe, expect, it } from 'vitest';
import {
  buildMemoryNote,
  decayMemoryNotes,
  isArchived,
  mergeMemoryNotes,
  normalizeSubjectKey,
} from '../services/memory/memoryWriter';
import {
  MIN_LEXICAL_SCORE,
  jaccard,
  recallMemories,
  recencyScore,
  scoreMemoryNote,
  tokenize,
} from '../services/memory/memoryRetriever';
import type { GeneratedPlan, MemoryNote } from '../types';

function fixturePlan(overrides: Partial<GeneratedPlan> = {}): GeneratedPlan {
  return {
    id: 'p1',
    goal: '学习 Python 基础',
    planType: 'tasks',
    userType: 'balanced',
    category: '学习',
    createdAt: '2026-09-01T00:00:00.000Z',
    engineVersion: 1,
    accepted: true,
    days: [
      {
        date: '2026-09-01',
        tasks: [
          { title: '装好 Python 环境', category: '学习', estimatedMinutes: 30 },
          { title: '练语法基础', category: '学习', estimatedMinutes: 45 },
        ],
      },
      {
        date: '2026-09-02',
        tasks: [{ title: '写一个小脚本', category: '学习', estimatedMinutes: 60 }],
      },
    ],
    strategy: {
      methodology: ['间隔重复'],
      risks: ['贪多求快', '缺少反馈'],
      successCriteria: ['连续 7 天完成'],
    },
    ...overrides,
  };
}

describe('normalizeSubjectKey', () => {
  it('去掉空白与标点并转小写，使同一目标能合并', () => {
    expect(normalizeSubjectKey('学习 Python，基础！')).toBe(normalizeSubjectKey('学习python基础'));
  });
});

describe('buildMemoryNote', () => {
  it('接受计划 → 写入结论、统计事实与证据引用', () => {
    const note = buildMemoryNote({
      plan: fixturePlan(),
      accepted: true,
      completionRate: 0.5,
      now: new Date('2026-09-10T00:00:00.000Z'),
    });

    expect(note.kind).toBe('episodic');
    expect(note.subject).toBe('学习 Python 基础');
    expect(note.summary).toContain('已接受 2 天计划');
    expect(note.summary).toContain('历史完成率 50%');
    expect(note.confidence).toBe(0.6);
    expect(note.hitCount).toBe(0);
    expect(note.sourcePlanId).toBe('p1');
    expect(note.category).toBe('学习');
    expect(note.evidence).toContain('plan:p1');
    expect(note.stats).toMatchObject({ accepted: true, plannedDays: 2, plannedItems: 3 });
    expect(note.stats?.riskHits).toEqual(['贪多求快', '缺少反馈']);
  });

  it('拒绝计划 → 保留用户反馈作为证据，置信度更低', () => {
    const note = buildMemoryNote({
      plan: fixturePlan(),
      accepted: false,
      feedback: '每天时间太长，想拆碎一点',
      now: new Date('2026-09-10T00:00:00.000Z'),
    });
    expect(note.confidence).toBeLessThan(0.6);
    expect(note.summary).toContain('不合适');
    expect(note.summary).toContain('想拆碎一点');
    expect(note.evidence.some((e) => e.startsWith('feedback:'))).toBe(true);
  });
});

describe('mergeMemoryNotes', () => {
  it('同主题合并为一条：置信度上调、证据累积、不重复堆积', () => {
    const first = buildMemoryNote({ plan: fixturePlan(), accepted: false, feedback: '太长' });
    const second = buildMemoryNote({
      plan: fixturePlan({ id: 'p2', createdAt: '2026-09-20T00:00:00.000Z' }),
      accepted: true,
    });

    const { notes, merged } = mergeMemoryNotes([first], second, new Date('2026-09-21T00:00:00.000Z'));

    expect(merged).toBe(true);
    expect(notes).toHaveLength(1);
    expect(notes[0].confidence).toBeGreaterThan(first.confidence);
    expect(notes[0].summary).toBe(second.summary);
    expect(notes[0].stats?.accepted).toBe(true);
    expect(notes[0].evidence).toContain('plan:p1');
    expect(notes[0].evidence).toContain('plan:p2');
  });

  it('不同主题各自保留', () => {
    const a = buildMemoryNote({ plan: fixturePlan(), accepted: true });
    const b = buildMemoryNote({
      plan: fixturePlan({ id: 'p3', goal: '每周健身三次' }),
      accepted: true,
    });
    const { notes, merged } = mergeMemoryNotes([a], b);
    expect(merged).toBe(false);
    expect(notes).toHaveLength(2);
  });
});

describe('decayMemoryNotes', () => {
  it('长期未写入/召回的条目降置信度，最近用过的不动', () => {
    const stale = buildMemoryNote({
      plan: fixturePlan(),
      accepted: true,
      now: new Date('2026-06-01T00:00:00.000Z'),
    });
    const fresh = buildMemoryNote({
      plan: fixturePlan({ id: 'p4' }),
      accepted: true,
      now: new Date('2026-09-25T00:00:00.000Z'),
    });

    const { notes, decayed } = decayMemoryNotes([stale, fresh], new Date('2026-09-28T00:00:00.000Z'));

    expect(decayed).toBe(1);
    expect(notes[0].confidence).toBeLessThan(stale.confidence);
    expect(notes[1].confidence).toBe(fresh.confidence);
  });

  it('置信度有下限，不会衰减到 0（归档而非消失）', () => {
    const stale: MemoryNote = {
      ...buildMemoryNote({ plan: fixturePlan(), accepted: false, now: new Date('2020-01-01T00:00:00.000Z') }),
      confidence: 0.2,
    };
    const { notes } = decayMemoryNotes([stale], new Date('2026-09-28T00:00:00.000Z'), { floor: 0.15 });
    expect(notes[0].confidence).toBe(0.18);
    expect(isArchived({ ...notes[0], confidence: 0.1 })).toBe(true);
    expect(isArchived(notes[0])).toBe(false);
  });
});

describe('memoryRetriever', () => {
  it('tokenize 同时覆盖中文 2-gram 与英文词', () => {
    const tokens = tokenize('学习 Python');
    expect(tokens.has('学习')).toBe(true);
    expect(tokens.has('python')).toBe(true);
  });

  it('jaccard 与 recency 基础语义', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
    expect(jaccard(new Set(), new Set(['a']))).toBe(0);
    const now = new Date('2026-09-28T00:00:00.000Z');
    expect(recencyScore('2026-09-25T00:00:00.000Z', now)).toBe(1);
    expect(recencyScore('2026-01-01T00:00:00.000Z', now)).toBeLessThan(1);
  });

  it('召回：同主题的记忆被召回，同类但不同主题的被相关性闸门挡住', () => {
    const python = buildMemoryNote({ plan: fixturePlan(), accepted: true });
    const gym = buildMemoryNote({
      plan: fixturePlan({ id: 'p5', goal: '每周健身三次', category: '健身' }),
      accepted: true,
    });

    const hits = recallMemories([gym, python], {
      goal: '学习 Python 基础',
      category: '学习',
      limit: 2,
      now: new Date('2026-09-02T00:00:00.000Z'),
    });

    expect(hits.map((h) => h.note.id)).toEqual([python.id]);
    expect(hits[0].scoreDetail.category).toBe(1);
  });

  it('召回：低于置信度阈值的记忆（已归档）不进结果', () => {
    const archived: MemoryNote = { ...buildMemoryNote({ plan: fixturePlan(), accepted: true }), confidence: 0.1 };
    const hits = recallMemories([archived], { goal: '学习 Python 基础', category: '学习' });
    expect(hits).toHaveLength(0);
  });

  it('召回：完全不相关的目标不会硬塞历史 —— 闸门看的是相关性而不是分数', () => {
    const note = buildMemoryNote({
      plan: fixturePlan({ id: 'p6', goal: '每周健身三次', category: '健身' }),
      accepted: true,
    });
    const hit = scoreMemoryNote(note, { goal: '写一部小说', category: '创作' });

    // 该记忆"新且自信"（recency + confidence 就贡献 0.4 分），但词面不重合，
    // 仍必须被相关性闸门挡掉 —— 否则记忆会退化成无差别污染上下文。
    expect(hit.scoreDetail.lexical).toBeLessThan(MIN_LEXICAL_SCORE);
    expect(hit.score).toBeGreaterThan(MIN_LEXICAL_SCORE);
    expect(recallMemories([note], { goal: '写一部小说', category: '创作' })).toHaveLength(0);
  });
});
