// src/features/plan-generator/__tests__/resourceService.test.ts
// 阶段 2 测试：关键词解析容错、打分/去重/分组、三层编排与降级。
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_PER_TYPE,
  collectResources,
  dedupeResources,
  extractKeywords,
  groupAndTruncate,
  hashString,
  normalizeUrl,
  parseKeywordsJson,
  scoreResource,
} from '../services/resourceService';
import { buildJumpLinks, buildJumpLinkGroups } from '../services/resources/jumpLinks';
import { mapSearxngResults, engineProfile } from '../services/resources/searxngSource';
import {
  cleanHtml,
  isNoisyVideo,
  mapBilibiliItems,
  parseDurationToMinutes,
} from '../services/resources/bilibiliSource';
import { DEFAULT_NETWORKING_SETTINGS, type ResourceItem } from '../types';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function item(partial: Partial<ResourceItem>): ResourceItem {
  return {
    id: partial.id ?? 'x',
    source: 'searxng',
    layer: 2,
    type: 'article',
    title: 't',
    url: 'https://example.com/a',
    ...partial,
  };
}

// ---------------- 跳转按钮（第三层） ----------------

describe('jumpLinks（第三层，纯链接）', () => {
  it('生成 6 个平台的搜索链接并正确编码关键词', () => {
    const links = buildJumpLinks('Python 入门');
    expect(links).toHaveLength(6);
    expect(links.map((l) => l.platform)).toEqual([
      'bilibili',
      'douban',
      'xiaohongshu',
      'douyin',
      'zhihu',
      'juejin',
    ]);
    const bili = links.find((l) => l.platform === 'bilibili')!;
    expect(bili.url).toBe(`https://search.bilibili.com/all?keyword=${encodeURIComponent('Python 入门')}`);
    const douyin = links.find((l) => l.platform === 'douyin')!;
    expect(douyin.url).toBe(`https://www.douyin.com/search/${encodeURIComponent('Python 入门')}`);
    const zhihu = links.find((l) => l.platform === 'zhihu')!;
    expect(zhihu.url).toContain('/search?type=content&q=');
  });

  it('关键词去重并按顺序分组', () => {
    const groups = buildJumpLinkGroups(['a', 'b', 'a', '  ']);
    expect(groups.map((g) => g.keyword)).toEqual(['a', 'b']);
    expect(groups[0].links).toHaveLength(6);
  });
});

// ---------------- 关键词解析 ----------------

describe('parseKeywordsJson / extractKeywords', () => {
  it('解析并夹紧优先级、丢弃过短关键词', () => {
    const kws = parseKeywordsJson(
      JSON.stringify({
        keywords: [
          { keyword: 'Python 入门 教程', priority: 9, reason: 'r', lang: 'zh' },
          { keyword: 'x', priority: 1, reason: 'r' },
          { keyword: 'Python 练习 项目', priority: 2, reason: 'r', lang: 'en' },
        ],
      }),
    );
    expect(kws).toHaveLength(2);
    expect(kws[0].priority).toBe(3); // 9 被夹紧到 3
    expect(kws[1].lang).toBe('en');
  });

  it('不足 2 个关键词时抛错（触发模板降级）', () => {
    expect(() => parseKeywordsJson('{"keywords":[{"keyword":"只有一个"}]}')).toThrow();
  });

  it('AI 未开启 → 使用模板关键词', async () => {
    const res = await extractKeywords({
      goal: '学习 Python',
      days: 7,
      answers: [],
      userType: 'balanced',
      config: { enabled: false, provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: '' },
    });
    expect(res.source).toBe('template');
    expect(res.keywords[0].keyword).toContain('学习 Python');
  });
});

// ---------------- 打分 / 去重 / 分组 ----------------

describe('打分与去重', () => {
  it('可信度：手动资源 > B 站 > SearXNG 普通站点', () => {
    const ctx = { preferredDifficulty: 'unknown' as const, now: Date.now() };
    const manual = scoreResource(item({ source: 'manual', url: 'https://a.com/1' }), ctx);
    const bili = scoreResource(item({ source: 'bilibili', url: 'https://b.com/1' }), ctx);
    const web = scoreResource(item({ source: 'searxng', url: 'https://unknown.example/x' }), ctx);
    expect(manual.score!).toBeGreaterThan(bili.score!);
    expect(bili.score!).toBeGreaterThan(web.score!);
  });

  it('时效性：新资源得分高于旧资源', () => {
    const now = Date.now();
    const ctx = { preferredDifficulty: 'unknown' as const, now };
    const fresh = scoreResource(item({ publishedAt: new Date(now - 5 * 86400000).toISOString() }), ctx);
    const stale = scoreResource(item({ publishedAt: new Date(now - 800 * 86400000).toISOString() }), ctx);
    expect(fresh.score!).toBeGreaterThan(stale.score!);
    expect(fresh.scoreDetail!.freshness).toBeGreaterThan(stale.scoreDetail!.freshness);
  });

  it('难度匹配：命中偏好难度得分更高', () => {
    const ctx = { preferredDifficulty: 'beginner' as const, now: Date.now() };
    const hit = scoreResource(item({ difficulty: 'beginner' }), ctx);
    const miss = scoreResource(item({ difficulty: 'advanced' }), ctx);
    expect(hit.score!).toBeGreaterThan(miss.score!);
  });

  it('用户偏好：偏好视频时视频加分', () => {
    const ctx = { preferredDifficulty: 'unknown' as const, now: Date.now(), preferVideo: true };
    const video = scoreResource(item({ type: 'video' }), ctx);
    const article = scoreResource(item({ type: 'article' }), ctx);
    expect(video.score!).toBeGreaterThan(article.score!);
  });

  it('normalizeUrl 去掉追踪参数与 www', () => {
    expect(normalizeUrl('https://www.bilibili.com/video/BV1?spm_id_from=333.999&vd_source=x')).toBe(
      'bilibili.com/video/bv1',
    );
    expect(normalizeUrl('https://EXAMPLE.com/a/')).toBe('example.com/a');
  });

  it('去重：URL 变体与相同标题都被合并', () => {
    const { items, removed } = dedupeResources([
      item({ id: '1', url: 'https://www.a.com/x?utm_source=q', title: 'Python 入门教程' }),
      item({ id: '2', url: 'https://a.com/x', title: '另一个标题' }), // 同 URL
      item({ id: '3', url: 'https://b.com/y', title: 'Python 入门教程！' }), // 同标题
      item({ id: '4', url: 'https://c.com/z', title: '完全不同的内容标题' }),
    ]);
    expect(items.map((i) => i.id)).toEqual(['1', '4']);
    expect(removed).toBe(2);
  });

  it('分组截断：每类最多 5 条', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      item({ id: `v${i}`, type: 'video', url: `https://v.com/${i}`, title: `视频${i}` }),
    );
    const grouped = groupAndTruncate(many);
    expect(grouped.video).toHaveLength(MAX_PER_TYPE);
  });
});

// ---------------- B 站解析与过滤 ----------------

describe('bilibiliSource 解析', () => {
  it('清洗 HTML 标签与实体', () => {
    expect(cleanHtml('<em class="keyword">Python</em> 教程 &amp; 实战')).toBe('Python 教程 & 实战');
  });

  it('时长解析支持 MM:SS 与 H:MM:SS', () => {
    expect(parseDurationToMinutes('12:34')).toBe(13);
    expect(parseDurationToMinutes('1:02:03')).toBe(62);
    expect(parseDurationToMinutes('无')).toBeUndefined();
  });

  it('过滤广告与超长合集', () => {
    expect(isNoisyVideo('XX 课程 广告 限时特价', 20)).toBe(true);
    expect(isNoisyVideo('Python 全集 完整版', 200)).toBe(true);
    expect(isNoisyVideo('Python 入门 12 讲', 200)).toBe(true); // 超长
    expect(isNoisyVideo('Python 入门教程', 45)).toBe(false);
  });

  it('映射为统一结构并丢弃非视频/无效链接', () => {
    const items = mapBilibiliItems(
      [
        { type: 'video', bvid: 'BV1xx', title: '<em>Python</em> 入门', author: 'UP主', duration: '12:00', play: 12345, pubdate: 1735689600 },
        { type: 'article', title: '专栏', arcurl: 'https://x' },
        { type: 'video', title: '广告 促销', bvid: 'BV2', duration: '10:00' },
        { type: 'video', title: '长合集', bvid: 'BV3', duration: '5:00:00' },
      ],
      'Python 入门',
      hashString,
    );
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Python 入门');
    expect(items[0].url).toBe('https://www.bilibili.com/video/BV1xx');
    expect(items[0].durationMinutes).toBe(12);
    expect(items[0].metrics?.views).toBe(12345);
    expect(items[0].layer).toBe(1);
  });
});

describe('searxngSource 映射', () => {
  it('引擎决定类型与可信度', () => {
    expect(engineProfile('douban').type).toBe('book');
    expect(engineProfile('juejin').type).toBe('post');
    expect(engineProfile('unknown-engine').type).toBe('article');
  });

  it('映射结果并推断难度', () => {
    const items = mapSearxngResults(
      [
        { url: 'https://zhuanlan.zhihu.com/p/1', title: 'Python 入门到进阶', content: '零基础也能学', engine: 'zhihu' },
        { url: 'not-a-url', title: '坏数据' },
      ],
      'Python',
      hashString,
    );
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('article');
    expect(items[0].difficulty).toBe('beginner');
    expect(items[0].layer).toBe(2);
  });
});

// ---------------- 三层编排与降级（核心） ----------------

const noNetworkSettings = { ...DEFAULT_NETWORKING_SETTINGS };
const keywordList = [{ keyword: 'Python 入门', priority: 1 as const, reason: 'r' }];
const scoreCtx = { preferredDifficulty: 'unknown' as const };

describe('collectResources 降级策略', () => {
  it('默认设置（只开第三层）→ 不发任何网络请求，只返回跳转按钮', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const bundle = await collectResources({
      keywords: keywordList,
      settings: noNetworkSettings,
      scoreContext: scoreCtx,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(bundle.items).toHaveLength(0);
    expect(bundle.jumpGroups[0].links).toHaveLength(6);
    expect(bundle.layers.find((l) => l.layer === 1)!.enabled).toBe(false);
    expect(bundle.layers.find((l) => l.layer === 3)!.ok).toBe(true);
  });

  it('B 站失败 + SearXNG 未开 → 降级为仅跳转按钮（不抛错）', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('CORS blocked');
    }) as unknown as typeof fetch;

    const bundle = await collectResources({
      keywords: keywordList,
      settings: { ...noNetworkSettings, bilibili: true },
      scoreContext: scoreCtx,
    });

    expect(bundle.items).toHaveLength(0);
    expect(bundle.jumpGroups.length).toBe(1);
    const layer1 = bundle.layers.find((l) => l.layer === 1)!;
    expect(layer1.enabled).toBe(true);
    expect(layer1.ok).toBe(false);
    expect(bundle.warnings.join(' ')).toContain('第一层');
    expect(bundle.warnings.join(' ')).toContain('跳转按钮');
  });

  it('SearXNG 成功返回结果 → 映射并打分，层状态 ok', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              url: 'https://www.douban.com/subject/1',
              title: 'Python 编程 从入门到实践',
              content: '经典入门书',
              engine: 'douban',
            },
            { url: 'https://juejin.cn/post/2', title: '进阶：Python 异步', content: '深入原理', engine: 'juejin' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    const bundle = await collectResources({
      keywords: keywordList,
      settings: { ...noNetworkSettings, searxng: true },
      scoreContext: scoreCtx,
    });

    expect(bundle.items.length).toBe(2);
    expect(bundle.grouped.book).toHaveLength(1);
    expect(bundle.grouped.post).toHaveLength(1);
    expect(bundle.layers.find((l) => l.layer === 2)!.ok).toBe(true);
    expect(bundle.items[0].score).toBeGreaterThan(0);
  });

  it('SearXNG 超时（100ms）→ 立即降级，不阻塞', async () => {
    globalThis.fetch = vi.fn(
      (_url: unknown, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as unknown as typeof fetch;

    const started = Date.now();
    const bundle = await collectResources({
      keywords: keywordList,
      settings: { ...noNetworkSettings, searxng: true, timeoutMs: 100 },
      scoreContext: scoreCtx,
    });
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(2000);
    expect(bundle.items).toHaveLength(0);
    const layer2 = bundle.layers.find((l) => l.layer === 2)!;
    expect(layer2.ok).toBe(false);
    expect(bundle.warnings.join(' ')).toContain('SearXNG');
    // 兜底仍在
    expect(bundle.jumpGroups.length).toBeGreaterThan(0);
  });

  it('本地资源库条目会被并入候选资源', async () => {
    const bundle = await collectResources({
      keywords: keywordList,
      settings: noNetworkSettings,
      manualResources: [
        {
          id: 'm1',
          title: '我收藏的 Python 入门课',
          url: 'https://example.com/course',
          type: 'video',
          keywords: ['Python'],
          createdAt: new Date().toISOString(),
        },
      ],
      scoreContext: scoreCtx,
    });
    expect(bundle.items).toHaveLength(1);
    expect(bundle.items[0].source).toBe('manual');
    expect(bundle.warnings.join(' ')).toContain('资源库');
  });

  it('三层全失败/全关闭时，计划所需的最少信息仍然存在（跳转按钮）', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const bundle = await collectResources({
      keywords: keywordList,
      settings: { ...noNetworkSettings, bilibili: true, searxng: true },
      scoreContext: scoreCtx,
    });
    expect(bundle.items).toHaveLength(0);
    expect(bundle.jumpGroups[0].links.length).toBe(6);
    expect(bundle.warnings.join(' ')).toContain('仅"平台跳转按钮"');
  });
});
