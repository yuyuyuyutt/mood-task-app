// src/features/plan-generator/__tests__/hybridRetriever.test.ts
// 混合检索：RRF 融合语义序与启发式序、语义失败时的降级、以及 collectResources 的端到端接线。
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applySemanticRerank,
  fuseWithRRF,
  runSemanticRetrieval,
  summarizeSemantic,
} from '../services/rag/hybridRetriever';
import { buildQueryText, buildResourceText } from '../services/rag/embedding';
import { VectorStore, type VectorRecord, type VectorStoreBackend } from '../services/rag/vectorStore';
import { collectResources } from '../services/resourceService';
import type { ManualResource, NetworkingSettings, ResourceItem, SearchKeyword } from '../types';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function resource(id: string, title: string, extra: Partial<ResourceItem> = {}): ResourceItem {
  return {
    id,
    source: 'manual',
    layer: 3,
    type: 'article',
    title,
    url: `https://example.com/${id}`,
    score: 0.5,
    scoreDetail: { credibility: 0.5, freshness: 0.5, difficultyMatch: 0.5, preference: 0.5 },
    ...extra,
  };
}

/** 内存后端：替代 IndexedDB / SQLite，让检索逻辑可以纯单测 */
class MemoryBackend implements VectorStoreBackend {
  readonly kind = 'indexeddb' as const;
  readonly rows = new Map<string, { model: string; hash: string; vector: number[] }>();
  upsertCalls = 0;
  searchCalls = 0;
  failSearch = false;

  async hashes(namespace: string, model?: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const [key, value] of this.rows) {
      const [ns, refId] = key.split('::');
      if (ns !== namespace) continue;
      if (model && value.model !== model) continue;
      out.set(refId, value.hash);
    }
    return out;
  }

  async upsert(namespace: string, records: VectorRecord[]): Promise<number> {
    this.upsertCalls += 1;
    for (const r of records) {
      this.rows.set(`${namespace}::${r.refId}`, { model: r.model, hash: r.contentHash, vector: r.vector });
    }
    return records.length;
  }

  async search(
    namespace: string,
    query: number[],
    topK: number,
    minScore: number,
    model?: string,
  ): Promise<Array<{ refId: string; score: number; contentHash: string; model: string; updatedAt: string }>> {
    this.searchCalls += 1;
    if (this.failSearch) throw new Error('索引读取失败');
    const out: Array<{ refId: string; score: number; contentHash: string; model: string; updatedAt: string }> = [];
    for (const [key, value] of this.rows) {
      const [ns, refId] = key.split('::');
      if (ns !== namespace || (model && value.model !== model)) continue;
      const score = query.reduce((sum, v, i) => sum + v * (value.vector[i] ?? 0), 0);
      out.push({ refId, score, contentHash: value.hash, model: value.model, updatedAt: 'now' });
    }
    return out
      .filter((m) => m.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  async remove(): Promise<number> {
    return 0;
  }
  async clear(namespace: string): Promise<number> {
    let removed = 0;
    for (const key of [...this.rows.keys()]) {
      if (key.startsWith(`${namespace}::`)) {
        this.rows.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
  async stats() {
    return [];
  }
}

/** 按文本返回向量的 fetch 桩：同时支持批量 /api/embed 与逐条 /api/embeddings */
function stubEmbed(pick: (text: string) => number[]): { calls: Array<{ url: string; body: Record<string, unknown> }> } {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = vi.fn(async (input: unknown, init?: unknown) => {
    const body = JSON.parse(String(((init ?? {}) as RequestInit).body ?? '{}')) as Record<string, unknown>;
    const url = String(input);
    calls.push({ url, body });
    if (url.endsWith('/api/embed')) {
      const texts = (body.input ?? []) as string[];
      return new Response(JSON.stringify({ embeddings: texts.map(pick) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ embedding: pick(String(body.prompt ?? '')) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { calls };
}

function runtimeFor(store: MemoryBackend) {
  return {
    store: new VectorStore(store),
    config: { baseUrl: 'http://127.0.0.1:11434', model: 'nomic-embed-text', timeoutMs: 5000 },
  };
}

describe('fuseWithRRF', () => {
  it('两路都命中的条目排最前，且标记来源', () => {
    const fused = fuseWithRRF({ keyword: ['a', 'b', 'c'], semantic: ['c', 'd'] });
    expect(fused[0].id).toBe('c');
    expect(fused[0].sources.sort()).toEqual(['keyword', 'semantic']);
    // 只被语义命中（d）拿到语义名次分，排在只有关键词名次的 b 之后
    const order = fused.map((f) => f.id);
    expect(order.indexOf('c')).toBe(0);
    expect(order).toContain('a');
    expect(order).toContain('d');
  });

  it('语义为空时保持关键词顺序（不融合也不丢条）', () => {
    const fused = fuseWithRRF({ keyword: ['a', 'b'], semantic: [] });
    expect(fused.map((f) => f.id)).toEqual(['a', 'b']);
    expect(fused.every((f) => f.sources.includes('keyword'))).toBe(true);
  });

  it('权重可调：语义权重为 0 时等价于纯关键词排序', () => {
    const fused = fuseWithRRF(
      { keyword: ['a', 'b'], semantic: ['b'] },
      { weights: { keyword: 1, semantic: 0 } },
    );
    expect(fused.map((f) => f.id)).toEqual(['a', 'b']);
  });

  it('同分时按 id 稳定排序（结果可复现）', () => {
    const first = fuseWithRRF({ keyword: ['b', 'a'], semantic: [] });
    const second = fuseWithRRF({ keyword: ['b', 'a'], semantic: [] });
    expect(first.map((f) => f.id)).toEqual(second.map((f) => f.id));
  });
});

describe('applySemanticRerank', () => {
  it('把语义命中的资源提到前面，并写入第 5 维（不改写原四维分）', () => {
    const items = [resource('x1', '不相关的'), resource('x2', '相关的')];
    const reranked = applySemanticRerank(items, [{ id: 'x2', score: 0.82 }]);

    expect(reranked.map((r) => r.id)).toEqual(['x2', 'x1']);
    expect(reranked[0].scoreDetail?.semantic).toBe(0.82);
    expect(reranked[0].scoreDetail?.credibility).toBe(0.5);
    expect(reranked[0].score).toBe(0.5); // 原分不动
    expect(reranked[1].scoreDetail?.semantic).toBeUndefined();
  });

  it('语义没命中任何一条时原样返回', () => {
    const items = [resource('x1', 'A')];
    expect(applySemanticRerank(items, [])).toBe(items);
  });
});

describe('runSemanticRetrieval', () => {
  const items = [resource('x1', 'Python 入门教程'), resource('x2', '烹饪基础')];
  const query = '学习 Python 基础 Python 入门';

  it('未配置模型 / 没有候选时给出明确原因，不发请求', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const noModel = await runSemanticRetrieval({
      items,
      query,
      runtime: { ...runtimeFor(new MemoryBackend()), config: { baseUrl: 'x', model: '', timeoutMs: 1000 } },
    });
    expect(noModel.summary).toMatchObject({ enabled: false, degradedReason: '未配置 embedding 模型' });

    const empty = await runSemanticRetrieval({
      items: [],
      query,
      runtime: runtimeFor(new MemoryBackend()),
    });
    expect(empty.summary.enabled).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('首次运行会建立索引并返回语义序；第二次运行复用缓存不再嵌入', async () => {
    const backend = new MemoryBackend();
    // 只有与 query 同向的文本才拿到高分；烹饪与之近乎正交
    stubEmbed((text) => {
      if (text.includes('烹饪')) return [0.02, 1];
      return [0.98, 0.02];
    });

    const first = await runSemanticRetrieval({
      items,
      query,
      runtime: runtimeFor(backend),
    });
    expect(first.summary.enabled).toBe(true);
    expect(first.summary.embedded).toBe(2);
    expect(first.summary.reused).toBe(0);
    expect(first.ranked.map((r) => r.id)).toEqual(['x1']); // 烹饪被相似度阈值挡掉
    expect(backend.upsertCalls).toBe(1);

    const second = await runSemanticRetrieval({ items, query, runtime: runtimeFor(backend) });
    expect(second.summary.reused).toBe(2);
    expect(second.summary.embedded).toBe(0);
    expect(backend.upsertCalls).toBe(1); // 没有再写索引
    expect(second.ranked.map((r) => r.id)).toEqual(['x1']);
  });

  it('内容变了 → 该条会重算（哈希不一致不会被误当作命中）', async () => {
    const backend = new MemoryBackend();
    stubEmbed(() => [1, 0]);
    await runSemanticRetrieval({ items, query, runtime: runtimeFor(backend) });
    expect(backend.upsertCalls).toBe(1);

    const changed = [resource('x1', 'Python 入门教程（第二版）'), items[1]];
    const run = await runSemanticRetrieval({ items: changed, query, runtime: runtimeFor(backend) });
    expect(run.summary.embedded).toBe(1);
    expect(run.summary.reused).toBe(1);
    expect(backend.upsertCalls).toBe(2);
  });

  it('embedding 失败 → 降级为 enabled:false 并带上原因，永不抛出', async () => {
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;
    const run = await runSemanticRetrieval({ items, query, runtime: runtimeFor(new MemoryBackend()) });
    expect(run.summary.enabled).toBe(false);
    expect(run.summary.degradedReason).toContain('HTTP 500');
    expect(run.ranked).toEqual([]);
  });

  it('索引读取失败同样降级（不会把异常抛给计划生成流程）', async () => {
    const backend = new MemoryBackend();
    backend.failSearch = true;
    stubEmbed(() => [1, 0]);
    const run = await runSemanticRetrieval({ items, query, runtime: runtimeFor(backend) });
    expect(run.summary.enabled).toBe(false);
    expect(run.summary.degradedReason).toContain('索引读取失败');
  });
});

describe('summarizeSemantic', () => {
  it('把运行结果压成一句可展示的话', () => {
    expect(summarizeSemantic({ enabled: false, model: null, embedded: 0, reused: 0, matched: 0 })).toBe('');
    const line = summarizeSemantic({
      enabled: true,
      model: 'nomic-embed-text',
      embedded: 3,
      reused: 2,
      matched: 4,
    });
    expect(line).toContain('语义召回 4 条');
    expect(line).toContain('新索引 3 条');
    expect(line).toContain('复用缓存 2 条');
  });
});

describe('collectResources 接线（端到端）', () => {
  const manualResources: ManualResource[] = [
    { id: 'm1', title: '烹饪基础', url: 'https://example.com/cook', type: 'article', keywords: ['python'], createdAt: '2026-09-01' },
    { id: 'm2', title: 'Python 入门教程', url: 'https://example.com/py', type: 'article', keywords: ['python'], createdAt: '2026-09-01' },
  ];
  const kw: SearchKeyword[] = [{ keyword: 'python', priority: 1, reason: '', lang: 'zh' }];
  const settings: NetworkingSettings = {
    bilibili: false,
    searxng: false,
    searxngBaseUrl: '',
    searxngEngines: [],
    jumpLinks: false,
    timeoutMs: 1000,
    preferredDifficulty: 'unknown',
  };
  const scoreContext = { preferredDifficulty: 'unknown' as const };

  it('开启语义检索后：语义相关的资源被提到最前，并写入第 5 维', async () => {
    stubEmbed((text) => (text.includes('烹饪') ? [0.02, 1] : [0.98, 0.02]));
    const goal = '学习 Python 基础';

    const bundle = await collectResources({
      keywords: kw,
      settings,
      manualResources,
      scoreContext,
      rag: {
        goal,
        runtime: runtimeFor(new MemoryBackend()),
      },
    });

    // 关键词顺序下"烹饪基础"先入列，语义融合后应被 Python 教程反超
    expect(bundle.items[0].title).toBe('Python 入门教程');
    expect(bundle.semantic?.enabled).toBe(true);
    expect(bundle.semantic?.matched).toBeGreaterThan(0);
    expect(typeof bundle.items[0].scoreDetail?.semantic).toBe('number');
    expect(bundle.warnings.some((w) => w.includes('语义召回'))).toBe(true);

    // 分组也应当跟随重排后的顺序（保证 UI 里每类的第一条是语义最优）
    expect(bundle.grouped.article[0].title).toBe('Python 入门教程');
  });

  it('语义服务不可用 → 明确写入降级原因，排序退回关键词（计划仍可生成）', async () => {
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;

    const bundle = await collectResources({
      keywords: kw,
      settings,
      manualResources,
      scoreContext,
      rag: { goal: '学习 Python 基础', runtime: runtimeFor(new MemoryBackend()) },
    });

    expect(bundle.semantic?.enabled).toBe(false);
    expect(bundle.warnings.some((w) => w.includes('语义检索已降级为关键词排序'))).toBe(true);
    expect(bundle.items.length).toBe(2);
    expect(bundle.items[0].title).toBe('烹饪基础'); // 保持原启发式顺序
  });

  it('不传 rag 时行为与改造前一致（不强依赖向量能力）', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const bundle = await collectResources({
      keywords: kw,
      settings,
      manualResources,
      scoreContext,
    });
    expect(bundle.semantic).toBeUndefined();
    expect(bundle.items.length).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(buildQueryText('学习 Python', kw)).toContain('python');
    expect(buildResourceText(resource('x', '标题'))).toContain('标题');
  });
});
