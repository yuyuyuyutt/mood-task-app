// src/features/plan-generator/__tests__/ragEmbedding.test.ts
// 本地 embedding 层：内容寻址、接口兼容与降级判定。
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildQueryText,
  buildResourceText,
  cosineSimilarity,
  embedTexts,
  hashText,
  normalizeVector,
  planEmbeddingWork,
  probeEmbedding,
  shouldFallbackToLegacy,
} from '../services/rag/embedding';
import type { ResourceItem, SearchKeyword } from '../types';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function resource(title: string, overrides: Partial<ResourceItem> = {}): ResourceItem {
  return {
    id: `manual:${hashText(title)}`,
    source: 'manual',
    layer: 3,
    type: 'article',
    title,
    url: `https://example.com/${encodeURIComponent(title)}`,
    ...overrides,
  };
}

const keywords: SearchKeyword[] = [
  { keyword: 'Python 入门', priority: 1, reason: '', lang: 'zh' },
  { keyword: 'Python 练习', priority: 2, reason: '', lang: 'zh' },
  { keyword: 'Python 项目', priority: 3, reason: '', lang: 'zh' },
];

describe('文本规范化与哈希', () => {
  it('hashText 稳定且区分内容', () => {
    expect(hashText('Python 入门教程')).toBe(hashText('Python 入门教程'));
    expect(hashText('Python 入门教程')).not.toBe(hashText('Python 入门教程 '));
    expect(hashText('a')).not.toBe(hashText('b'));
  });

  it('buildResourceText 只用元数据、不掺正文，且长度受限', () => {
    const text = buildResourceText(
      resource('深入理解计算机系统', {
        type: 'book',
        author: 'Randal',
        difficulty: 'advanced',
        snippet: 'x'.repeat(500),
      }),
    );
    expect(text).toContain('深入理解计算机系统');
    expect(text).toContain('类型：book');
    expect(text).toContain('作者：Randal');
    expect(text).toContain('难度：advanced');
    expect(text.length).toBeLessThanOrEqual(400);
  });

  it('buildQueryText 合并目标与高优先级关键词', () => {
    const q = buildQueryText('学习 Python 基础', keywords, 2);
    expect(q).toContain('学习 Python 基础');
    expect(q).toContain('Python 入门');
    expect(q).toContain('Python 练习');
    expect(q).not.toContain('Python 项目');
  });
});

describe('向量数值工具', () => {
  it('normalizeVector 得到单位向量，零向量不产生 NaN', () => {
    const v = normalizeVector([3, 4]);
    expect(v[0]).toBeCloseTo(0.6, 6);
    expect(v[1]).toBeCloseTo(0.8, 6);
    expect(normalizeVector([0, 0])).toEqual([0, 0]);
  });

  it('cosineSimilarity：同向为 1、反向为 -1、维度不一致为 0', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(-1);
    expect(cosineSimilarity([1, 0, 0], [1, 0])).toBe(0);
  });
});

describe('planEmbeddingWork（内容寻址缓存）', () => {
  it('新内容要算、内容变了的要重算、没变的复用', () => {
    const refs = [
      { refId: 'a', hash: 'h-a' },
      { refId: 'b', hash: 'h-b-new' },
      { refId: 'c', hash: 'h-c' },
    ];
    const existing = new Map([
      ['a', 'h-a'], // 未变 → 复用
      ['b', 'h-b-old'], // 变了 → 重算
    ]);
    const work = planEmbeddingWork(refs, existing);
    expect(work.reused).toBe(1);
    expect(work.toEmbed).toEqual(['b', 'c']);
  });

  it('全部命中缓存时不做任何 embedding', () => {
    const refs = [{ refId: 'a', hash: 'h' }];
    expect(planEmbeddingWork(refs, new Map([['a', 'h']]))).toEqual({ toEmbed: [], reused: 1 });
  });
});

describe('shouldFallbackToLegacy', () => {
  it('只有"端点不存在/不接受输入"才退回老接口', () => {
    expect(shouldFallbackToLegacy('HTTP 404：not found')).toBe(true);
    expect(shouldFallbackToLegacy('HTTP 400：bad request')).toBe(true);
    expect(shouldFallbackToLegacy('embed 接口返回结构不符合预期（缺少 embeddings 数组）')).toBe(true);
    // 超时与 5xx 换端点也一样，不该再白等一轮
    expect(shouldFallbackToLegacy('embedding 请求超时（15000ms）')).toBe(false);
    expect(shouldFallbackToLegacy('HTTP 500：boom')).toBe(false);
  });
});

describe('embedTexts', () => {
  function stubEmbed(pick: (text: string) => number[]): { calls: Array<{ url: string; body: Record<string, unknown> }> } {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = vi.fn(async (input: unknown, init?: unknown) => {
      const requestInit = (init ?? {}) as RequestInit;
      const body = JSON.parse(String(requestInit.body ?? '{}')) as Record<string, unknown>;
      const url = String(input);
      calls.push({ url, body });
      if (url.endsWith('/api/embed')) {
        const texts = (body.input ?? []) as string[];
        return new Response(JSON.stringify({ embeddings: texts.map(pick) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/api/embeddings')) {
        return new Response(JSON.stringify({ embedding: pick(String(body.prompt ?? '')) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;
    return { calls };
  }

  const config = { baseUrl: 'http://127.0.0.1:11434', model: 'nomic-embed-text', timeoutMs: 5000 };

  it('走批量接口 /api/embed，返回同序的归一化向量', async () => {
    const { calls } = stubEmbed((text) => (text.includes('Python') ? [3, 4] : [1, 0]));
    const vectors = await embedTexts(['Python 入门', '烹饪基础'], config);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://127.0.0.1:11434/api/embed');
    expect(calls[0].body.model).toBe('nomic-embed-text');
    expect(calls[0].body.input).toEqual(['Python 入门', '烹饪基础']);
    expect(vectors).toHaveLength(2);
    expect(vectors[0][1]).toBeCloseTo(0.8, 6); // 已归一化
  });

  it('端点不存在（404）→ 逐条退回 /api/embeddings', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = vi.fn(async (input: unknown, init?: unknown) => {
      const url = String(input);
      const body = JSON.parse(String(((init ?? {}) as RequestInit).body ?? '{}')) as Record<string, unknown>;
      calls.push({ url, body });
      if (url.endsWith('/api/embed')) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify({ embedding: [0, 2] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const vectors = await embedTexts(['a', 'b'], config);
    expect(calls.map((c) => c.url.endsWith('/api/embeddings'))).toEqual([false, true, true]);
    expect(calls[0].body.input).toEqual(['a', 'b']);
    expect(vectors).toEqual([
      [0, 1],
      [0, 1],
    ]);
  });

  it('HTTP 500 不在本层重试，直接抛错交给上层降级', async () => {
    const { calls } = stubEmbed(() => [1, 0]);
    globalThis.fetch = vi.fn(async (input: unknown, init?: unknown) => {
      calls.push({ url: String(input), body: JSON.parse(String(((init ?? {}) as RequestInit).body ?? '{}')) });
      return new Response('boom', { status: 500 });
    }) as unknown as typeof fetch;

    await expect(embedTexts(['a'], config)).rejects.toThrow('HTTP 500');
    expect(calls).toHaveLength(1);
  });

  it('空数组直接返回、缺模型或空文本抛错', async () => {
    expect(await embedTexts([], config)).toEqual([]);
    await expect(embedTexts(['a'], { ...config, model: '' })).rejects.toThrow('未配置 embedding 模型');
    await expect(embedTexts(['   '], config)).rejects.toThrow('存在空的待嵌入文本');
  });

  it('probeEmbedding 成功时报出维度，失败时给出 ollama pull 提示', async () => {
    stubEmbed(() => [1, 0, 0, 0]);
    const ok = await probeEmbedding(config.baseUrl, config.model);
    expect(ok).toMatchObject({ ok: true, dim: 4 });

    globalThis.fetch = vi.fn(async () => {
      throw new Error('无法连接');
    }) as unknown as typeof fetch;
    const bad = await probeEmbedding(config.baseUrl, 'bge-m3');
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('ollama pull bge-m3');
  });
});
