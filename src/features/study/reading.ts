// src/features/study/reading.ts
// 「应用内阅读模式」的编排（把"能不能读、为什么读不到"讲清楚）。
//
// 三条硬约束（都来自既有架构，不能绕过）：
//   1) 只读**白名单域名**（空白名单 = 一律不抓）——抓正文是"主动访问第三方站点"的动作；
//   2) 正文只进临时缓存（7 天 / 20 页 / 单页 6000 字），**不进备份**；
//   3) 桌面端经 Rust 代理抓取（拒内网 + 体积上限），浏览器开发模式直连并降级。
//
// 本模块的价值在于：把 `fetchPageText` 的 `{ok:false}` 翻译成**用户能照着做的原因**，
// 并给出"加白名单"这条最短路径（`nextStep` 字段）。
import {
  MAX_FETCH_CHARS,
  fetchPageText,
  hostOf,
  isDomainAllowed,
  normalizeDomain,
  type FetchPageOptions,
  type FetchPageResult,
} from '../plan-generator/services/rag/contentFetcher';
import type { EmbeddingSettings } from '../plan-generator/types';
import type { ReadingOutcome } from './types';

/** 可注入的抓取实现（默认走真实 `fetchPageText`；测试里替换成假实现） */
export type PageFetcher = (url: string, options: FetchPageOptions) => Promise<FetchPageResult>;

export interface OpenReadingParams {
  url: string;
  settings: Pick<EmbeddingSettings, 'contentFetch' | 'allowedDomains' | 'timeoutMs'>;
  title?: string;
  fetchPage?: PageFetcher;
  signal?: AbortSignal;
}

/** 这个 URL 现在能不能在应用内读（用于决定是否展示"加入白名单"按钮） */
export function canReadInApp(
  url: string,
  settings: Pick<EmbeddingSettings, 'contentFetch' | 'allowedDomains'>,
): boolean {
  if (!settings.contentFetch) return false;
  return isDomainAllowed(url, settings.allowedDomains);
}

/** 从 URL 取出可加入白名单的域名（失败返回空串） */
export function domainOf(url: string): string {
  try {
    return normalizeDomain(hostOf(url));
  } catch {
    return '';
  }
}

/**
 * 打开阅读模式。
 * 永不抛错：读不到就返回带 `reason` 的失败结果，由界面给出下一步动作。
 */
export async function openReading(params: OpenReadingParams): Promise<ReadingOutcome> {
  const { url, settings, title, signal } = params;
  const fetchPage = params.fetchPage ?? fetchPageText;
  const domain = domainOf(url);
  const base = { url, domain, title: title ?? '' };

  if (!settings.contentFetch) {
    return {
      ...base,
      status: 'disabled',
      text: '',
      reason: '正文抓取未开启。开启后，白名单站点的正文可以在应用内阅读（数据不出本机）。',
    };
  }
  if (settings.allowedDomains.length === 0) {
    return {
      ...base,
      status: 'blocked',
      text: '',
      reason: '还没有配置允许抓取的域名。留空表示不抓任何站点。',
    };
  }
  if (!isDomainAllowed(url, settings.allowedDomains)) {
    return {
      ...base,
      status: 'blocked',
      text: '',
      reason: `「${domain || '该域名'}」不在抓取白名单里。`,
    };
  }

  const result = await fetchPage(url, {
    timeoutMs: settings.timeoutMs,
    allowedDomains: settings.allowedDomains,
    maxChars: MAX_FETCH_CHARS,
    useCache: true,
    signal,
  });

  if (!result.ok) {
    return {
      ...base,
      status: 'failed',
      text: '',
      reason: result.error ?? '抓取失败（可能是站点限流、需要登录或网络不可用）',
    };
  }

  return {
    ...base,
    // cache = 直接命中 7 天内的缓存（秒开）；fetched = 本次抓取
    status: result.source === 'cache' ? 'cache' : 'fetched',
    title: result.title || title || domain,
    text: result.text,
    // Markdown 只用于阅读展示；没有它时 ReadingView 会退回纯文本段落
    markdown: result.markdown,
    truncated: result.truncated,
  };
}

/** 把正文切成段落（阅读模式按段落渲染，不注入任何 HTML） */
export function toParagraphs(text: string, maxParagraphs = 200): string[] {
  return text
    .split(/\n{2,}|\r\n{2,}/)
    .map((p) => p.replace(/[ \t]+/g, ' ').trim())
    .filter((p) => p.length > 0)
    .slice(0, maxParagraphs);
}

/** 阅读进度文案（"已读 1.2k 字"这类），同时用于判断正文是否为空 */
export function readingStats(text: string): { chars: number; paragraphs: number } {
  return { chars: text.length, paragraphs: toParagraphs(text).length };
}
