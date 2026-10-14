// src/features/study/__tests__/reading.test.ts
// 阅读模式：白名单闸门、原因可解释、缓存命中、抓取失败降级。
// 用**注入的假抓取器**（而不是 vi.mock）：默认实现是真实网络调用，注入更容易看清行为边界。
import { describe, expect, it, vi } from 'vitest';
import { canReadInApp, domainOf, openReading, readingStats, toParagraphs } from '../reading';
import type { PageFetcher } from '../reading';

const settings = (over: Partial<{ contentFetch: boolean; allowedDomains: string[]; timeoutMs: number }> = {}) => ({
  contentFetch: true,
  allowedDomains: ['bilibili.com'],
  timeoutMs: 5_000,
  ...over,
});

function fetcher(result: Partial<Awaited<ReturnType<PageFetcher>>>): PageFetcher {
  return vi.fn(async (url: string) => ({
    ok: true,
    url,
    title: '视频：Python 入门',
    text: '第一段。\n\n第二段。',
    source: 'tauri' as const,
    ...result,
  })) as unknown as PageFetcher;
}

describe('reading：能不能读、为什么读不到', () => {
  it('未开启正文抓取 -> disabled，并给出开启路径', async () => {
    const outcome = await openReading({
      url: 'https://www.bilibili.com/video/BV1',
      settings: settings({ contentFetch: false }),
      fetchPage: fetcher({}),
    });
    expect(outcome.status).toBe('disabled');
    expect(outcome.reason).toContain('正文抓取未开启');
  });

  it('白名单为空 -> blocked（留空表示不抓任何站点）', async () => {
    const outcome = await openReading({
      url: 'https://www.bilibili.com/video/BV1',
      settings: settings({ allowedDomains: [] }),
      fetchPage: fetcher({}),
    });
    expect(outcome.status).toBe('blocked');
    expect(outcome.reason).toContain('没有配置允许抓取的域名');
  });

  it('域名不在白名单 -> blocked，原因里带上该域名', async () => {
    const outcome = await openReading({
      url: 'https://zhihu.com/question/1',
      settings: settings(),
      fetchPage: fetcher({}),
    });
    expect(outcome.status).toBe('blocked');
    expect(outcome.domain).toBe('zhihu.com');
    expect(outcome.reason).toContain('zhihu.com');
  });

  it('命中缓存 -> status=cache（秒开），并透传截断标记', async () => {
    const outcome = await openReading({
      url: 'https://www.bilibili.com/video/BV1',
      settings: settings(),
      fetchPage: fetcher({ source: 'cache', truncated: true }),
    });
    expect(outcome.status).toBe('cache');
    expect(outcome.truncated).toBe(true);
    expect(outcome.text).toContain('第一段');
  });

  it('本次抓取 -> status=fetched（不暴露 tauri/browser 的实现细节）', async () => {
    const outcome = await openReading({
      url: 'https://www.bilibili.com/video/BV1',
      settings: settings(),
      fetchPage: fetcher({ source: 'browser' }),
    });
    expect(outcome.status).toBe('fetched');
  });

  it('透传 Markdown（阅读模式优先渲染它；没有时回退纯文本）', async () => {
    const withMarkdown = await openReading({
      url: 'https://www.bilibili.com/video/BV1',
      settings: settings(),
      fetchPage: fetcher({ markdown: '# 标题\n\n这是**重点**' }),
    });
    expect(withMarkdown.markdown).toContain('**重点**');
    expect(withMarkdown.text).toContain('第一段'); // 检索用的纯文本照旧

    // 浏览器直连 / 旧缓存没有 markdown：字段为 undefined，界面提示"纯文本模式"
    const plainOnly = await openReading({
      url: 'https://www.bilibili.com/video/BV1',
      settings: settings(),
      fetchPage: fetcher({}),
    });
    expect(plainOnly.markdown).toBeUndefined();
    expect(plainOnly.text).toBeTruthy();
  });

  it('抓取失败 -> failed，原因来自抓取器（不吞掉）', async () => {
    const outcome = await openReading({
      url: 'https://www.bilibili.com/video/BV1',
      settings: settings(),
      fetchPage: fetcher({ ok: false, text: '', error: '站点需要登录' }),
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toBe('站点需要登录');
  });

  it('canReadInApp：只有开关打开且域名命中才为 true', () => {
    expect(canReadInApp('https://www.bilibili.com/video/BV1', settings())).toBe(true);
    expect(canReadInApp('https://zhihu.com/x', settings())).toBe(false);
    expect(canReadInApp('https://www.bilibili.com/x', settings({ contentFetch: false }))).toBe(false);
  });

  it('domainOf 归一化子域；非法 URL 返回空串', () => {
    expect(domainOf('https://www.bilibili.com/video/BV1')).toBe('bilibili.com');
    expect(domainOf('不是链接')).toBe('');
  });

  it('正文按段落切分（不注入 HTML），并给出字数/段数', () => {
    const text = '第一段内容。\n\n   第二段内容。   \n\n\n第三段。';
    expect(toParagraphs(text)).toEqual(['第一段内容。', '第二段内容。', '第三段。']);
    expect(readingStats('abc')).toEqual({ chars: 3, paragraphs: 1 });
  });
});
