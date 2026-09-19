// src/features/plan-generator/services/resourceService.ts
// 阶段 2：资源检索编排。
//
// 三层策略（全部可独立开关，默认只启用第三层）：
//   1) B 站搜索 API（可选）—— 真实视频链接/标题/UP 主/时长/播放量；
//   2) SearXNG（可选）    —— 补充文章/书籍/技术帖；
//   3) 平台跳转按钮（默认启用，纯链接、不联网）。
// 三层结果统一为 ResourceItem，去重、打分、分组、截断（每类最多 5 条）。
// 任意一层失败或 5 秒超时 → 立即降级，永不阻塞计划生成。
import type {
  KeywordResult,
  LayerStatus,
  ManualResource,
  NetworkingSettings,
  ResourceBundle,
  ResourceDifficulty,
  ResourceItem,
  ResourceSourceId,
  ResourceType,
  SearchKeyword,
} from '../types';
import { asNumber, asString, extractJsonObject } from './jsonExtract';
import { callOllamaText, type LLMConfig } from './llmClient';
import { buildFallbackKeywords, buildKeywordPrompt } from './prompts';
import { llmTasks } from './llmTaskManager';
import { buildJumpLinkGroups } from './resources/jumpLinks';
import { searchBilibili } from './resources/bilibiliSource';
import { matchManualResources, searchSearxng } from './resources/searxngSource';

/** 每类资源最多保留条数 */
export const MAX_PER_TYPE = 5;
/** 资源总量上限 */
export const MAX_TOTAL = 20;
/** 每个关键词最多展示条数 */
export const MAX_PER_KEYWORD = 3;
/** 只用优先级最高的前两个关键词做联网检索 */
const NETWORK_KEYWORD_LIMIT = 2;

/** 稳定短哈希（用于生成去重 id，无需加密强度） */
export function hashString(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

// ==================== 检索关键词（LLM + 模板兜底） ====================

/** 解析 LLM 关键词输出；不足 2 个则抛错触发降级 */
export function parseKeywordsJson(text: string): SearchKeyword[] {
  const obj = extractJsonObject<{ keywords?: unknown }>(text);
  const raw = Array.isArray(obj.keywords) ? obj.keywords : [];
  const out: SearchKeyword[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const k = item as Record<string, unknown>;
    const keyword = asString(k.keyword, 40);
    if (keyword.length < 2) continue;
    const priority = asNumber(k.priority, 2, 1, 3) as 1 | 2 | 3;
    out.push({
      keyword,
      priority,
      reason: asString(k.reason, 120) || '与目标直接相关',
      lang: asString(k.lang, 4) === 'en' ? 'en' : 'zh',
    });
  }
  if (out.length < 2) throw new Error(`关键词数量不足（${out.length}）`);
  return out.slice(0, 6);
}

export interface ExtractKeywordParams {
  goal: string;
  days: number;
  answers: Array<{ id?: string; question: string; answer: string }>;
  userType: string;
  config: LLMConfig;
  signal?: AbortSignal;
}

/** 阶段 2 第一步：提取检索关键词（LLM 失败 → 模板关键词） */
export async function extractKeywords(params: ExtractKeywordParams): Promise<KeywordResult> {
  const { goal, days, answers, userType, config, signal } = params;
  if (!config.enabled || !config.model) {
    return {
      keywords: buildFallbackKeywords(goal),
      source: 'template',
      fallbackReason: config.enabled ? '未选择模型' : 'AI 增强未开启',
    };
  }
  try {
    const text = await llmTasks.run({
      kind: 'keywords',
      key: 'keywords',
      timeoutMs: config.timeoutMs ?? 90_000,
      signal,
      run: (taskSignal) =>
        callOllamaText(buildKeywordPrompt(goal, days, answers, userType), config, {
          signal: taskSignal,
        }),
    });
    return { keywords: parseKeywordsJson(text), source: 'llm' };
  } catch (err) {
    return {
      keywords: buildFallbackKeywords(goal),
      source: 'template',
      fallbackReason: err instanceof Error ? err.message : String(err),
    };
  }
}

// ==================== 打分 ====================

const SOURCE_CREDIBILITY: Record<ResourceSourceId, number> = {
  manual: 1, // 用户自己挑的资源最可信
  bilibili: 0.75,
  searxng: 0.6, // 具体按引擎覆盖
  jump: 0.4,
};

const ENGINE_CREDIBILITY: Record<string, number> = {
  douban: 0.85,
  zhihu: 0.8,
  juejin: 0.8,
  github: 0.85,
  wikipedia: 0.9,
};

export interface ScoreContext {
  preferredDifficulty: ResourceDifficulty;
  preferVideo?: boolean;
  preferReading?: boolean;
  preferHandsOn?: boolean;
  /** 历史点击偏好：source -> 归一化占比 */
  sourcePreference?: Partial<Record<ResourceSourceId, number>>;
  now?: number;
}

function credibilityOf(item: ResourceItem): number {
  if (item.source === 'manual') return SOURCE_CREDIBILITY.manual;
  if (item.source === 'bilibili') return SOURCE_CREDIBILITY.bilibili;
  if (item.source === 'jump') return SOURCE_CREDIBILITY.jump;
  // searxng：优先用 URL 域名里的引擎特征，其次看已有字段
  const host = safeHost(item.url);
  for (const [engine, score] of Object.entries(ENGINE_CREDIBILITY)) {
    if (host.includes(engine) || host.includes(engine.replace('douban', 'douban'))) return score;
  }
  if (host.includes('zhihu')) return 0.8;
  if (host.includes('juejin') || host.includes('github')) return 0.8;
  if (host.includes('bilibili')) return 0.75;
  return SOURCE_CREDIBILITY.searxng;
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function freshnessOf(publishedAt: string | undefined, now: number): number {
  if (!publishedAt) return 0.6;
  const t = new Date(publishedAt).getTime();
  if (!Number.isFinite(t)) return 0.6;
  const days = (now - t) / 86_400_000;
  if (days <= 30) return 1;
  if (days <= 180) return 0.75;
  if (days <= 365) return 0.55;
  return 0.4;
}

function difficultyMatchOf(item: ResourceItem, preferred: ResourceDifficulty): number {
  if (preferred === 'unknown' || !item.difficulty || item.difficulty === 'unknown') return 0.6;
  if (item.difficulty === preferred) return 1;
  const order: ResourceDifficulty[] = ['beginner', 'intermediate', 'advanced'];
  const a = order.indexOf(item.difficulty);
  const b = order.indexOf(preferred);
  if (a < 0 || b < 0) return 0.6;
  return Math.abs(a - b) === 1 ? 0.7 : 0.35;
}

function preferenceOf(item: ResourceItem, ctx: ScoreContext): number {
  let score = 0.5;
  if (ctx.preferVideo && item.type === 'video') score += 0.3;
  if (ctx.preferReading && (item.type === 'book' || item.type === 'article')) score += 0.3;
  if (ctx.preferHandsOn && item.type === 'post') score += 0.25;
  const clickRatio = ctx.sourcePreference?.[item.source];
  if (typeof clickRatio === 'number') score += Math.min(0.2, clickRatio * 0.2);
  return Math.min(1, score);
}

/** 综合打分：可信度 0.30 + 时效性 0.25 + 难度匹配 0.25 + 用户偏好 0.20 */
export function scoreResource(item: ResourceItem, ctx: ScoreContext): ResourceItem {
  const now = ctx.now ?? Date.now();
  const credibility = credibilityOf(item);
  const freshness = freshnessOf(item.publishedAt, now);
  const difficultyMatch = difficultyMatchOf(item, ctx.preferredDifficulty);
  const preference = preferenceOf(item, ctx);
  const score =
    credibility * 0.3 + freshness * 0.25 + difficultyMatch * 0.25 + preference * 0.2;
  return {
    ...item,
    score: Math.round(score * 1000) / 1000,
    scoreDetail: {
      credibility: round2(credibility),
      freshness: round2(freshness),
      difficultyMatch: round2(difficultyMatch),
      preference: round2(preference),
    },
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** 归一化 URL：去掉追踪参数与末尾斜杠，用于去重 */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const dropParams = ['utm_source', 'utm_medium', 'utm_campaign', 'spm_id_from', 'vd_source', 'from'];
    for (const p of dropParams) u.searchParams.delete(p);
    const query = u.searchParams.toString();
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${
      query ? `?${query}` : ''
    }`.toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
}

/** 标题指纹（去标点/空白） */
function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .slice(0, 24);
}

/** 去重：URL 优先，其次标题指纹；保留先出现（通常分更高）的一条 */
export function dedupeResources(items: ResourceItem[]): { items: ResourceItem[]; removed: number } {
  const seenUrl = new Set<string>();
  const seenTitle = new Set<string>();
  const out: ResourceItem[] = [];
  for (const item of items) {
    const urlKey = normalizeUrl(item.url);
    const tKey = titleKey(item.title);
    if (seenUrl.has(urlKey) || (tKey.length >= 6 && seenTitle.has(tKey))) continue;
    seenUrl.add(urlKey);
    seenTitle.add(tKey);
    out.push(item);
  }
  return { items: out, removed: items.length - out.length };
}

/** 分组 + 截断（每类最多 MAX_PER_TYPE 条） */
export function groupAndTruncate(items: ResourceItem[]): Record<ResourceType, ResourceItem[]> {
  const grouped: Record<ResourceType, ResourceItem[]> = {
    video: [],
    article: [],
    book: [],
    post: [],
    link: [],
  };
  for (const item of items) {
    if (grouped[item.type].length < MAX_PER_TYPE) grouped[item.type].push(item);
  }
  return grouped;
}

// ==================== 三层编排 ====================

export interface CollectParams {
  keywords: SearchKeyword[];
  settings: NetworkingSettings;
  manualResources?: ManualResource[];
  scoreContext: ScoreContext;
  signal?: AbortSignal;
}

/** 采集三层资源，统一为 ResourceBundle（任何一层失败都静默降级） */
export async function collectResources(params: CollectParams): Promise<ResourceBundle> {
  const { keywords, settings, manualResources = [], scoreContext, signal } = params;
  const warnings: string[] = [];
  const collected: ResourceItem[] = [];
  const layers: LayerStatus[] = [];

  const ordered = [...keywords].sort((a, b) => a.priority - b.priority);
  const networkKeywords = ordered.slice(0, NETWORK_KEYWORD_LIMIT);

  // ---- 第一层：B 站 ----
  const layer1: LayerStatus = { layer: 1, enabled: settings.bilibili, ok: false, count: 0 };
  if (settings.bilibili) {
    for (const kw of networkKeywords) {
      const res = await searchBilibili(kw.keyword, {
        timeoutMs: settings.timeoutMs || 5000,
        signal,
        hash: hashString,
      });
      if (res.ok) {
        collected.push(...res.items);
        layer1.count += res.items.length;
        layer1.ok = true;
      } else if (res.error) {
        layer1.note = res.error.slice(0, 160);
      }
      if (signal?.aborted) break;
    }
    if (!layer1.ok) {
      warnings.push(`第一层（B 站搜索）不可用，已降级：${layer1.note ?? '无结果'}`);
    }
  } else {
    layer1.note = '未开启';
  }
  layers.push(layer1);

  // ---- 第二层：SearXNG ----
  const layer2: LayerStatus = { layer: 2, enabled: settings.searxng, ok: false, count: 0 };
  if (settings.searxng) {
    const searxKeywords = ordered.slice(0, 3);
    for (const kw of searxKeywords) {
      const res = await searchSearxng(kw.keyword, settings, { signal, hash: hashString });
      if (res.ok) {
        collected.push(...res.items);
        layer2.count += res.items.length;
        layer2.ok = true;
      } else if (res.skipped) {
        layer2.note = '未配置实例地址，已跳过';
      } else if (res.error) {
        layer2.note = res.error.slice(0, 160);
      }
      if (signal?.aborted) break;
    }
    if (!layer2.ok) {
      warnings.push(`第二层（SearXNG）已跳过：${layer2.note ?? '无结果'}`);
    }
  } else {
    layer2.note = '未开启';
  }
  layers.push(layer2);

  // ---- 本地资源库（纯本地，不联网） ----
  let manualCount = 0;
  if (manualResources.length > 0) {
    for (const kw of ordered) {
      const hits = matchManualResources(manualResources, kw.keyword, hashString);
      if (hits.length > 0) {
        collected.push(...hits);
        manualCount += hits.length;
      }
    }
    if (manualCount > 0) warnings.push(`已并入你自己的资源库 ${manualCount} 条（本地，不联网）`);
  }

  // ---- 第三层：跳转按钮（默认启用，纯链接） ----
  const layer3: LayerStatus = {
    layer: 3,
    enabled: settings.jumpLinks,
    ok: settings.jumpLinks,
    count: 0,
    note: settings.jumpLinks ? undefined : '未开启',
  };
  const jumpGroups = settings.jumpLinks ? buildJumpLinkGroups(keywords) : [];
  layer3.count = jumpGroups.reduce((s, g) => s + g.links.length, 0);
  layers.push(layer3);

  // ---- 统一：打分 -> 去重 -> 截断 -> 分组 ----
  const scored = collected.map((item) => scoreResource(item, scoreContext));
  scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const { items: unique, removed } = dedupeResources(scored);
  if (removed > 0) warnings.push(`去重合并 ${removed} 条重复资源`);
  const capped = unique.slice(0, MAX_TOTAL);
  const grouped = groupAndTruncate(capped);

  const byKeyword = ordered
    .map((kw) => ({
      keyword: kw.keyword,
      items: capped.filter((i) => i.keyword === kw.keyword).slice(0, MAX_PER_KEYWORD),
    }))
    .filter((g) => g.items.length > 0);

  // 全层失败 → 明确的兜底说明
  const anyNetworkEnabled = settings.bilibili || settings.searxng;
  const anyNetworkOk = layer1.ok || layer2.ok || manualCount > 0;
  if (anyNetworkEnabled && !anyNetworkOk) {
    warnings.push('联网检索全部失败，已降级为仅"平台跳转按钮"，计划仍会正常生成');
  }

  return { items: capped, grouped, byKeyword, jumpGroups, layers, warnings };
}

/** 统计信息（UI 展示用） */
export function summarizeBundle(bundle: ResourceBundle): {
  total: number;
  byType: string;
  networkOk: boolean;
  jumpCount: number;
} {
  const byType = (Object.keys(bundle.grouped) as ResourceType[])
    .filter((t) => bundle.grouped[t].length > 0)
    .map((t) => `${t}×${bundle.grouped[t].length}`)
    .join(' ');
  return {
    total: bundle.items.length,
    byType: byType || '无',
    networkOk: bundle.layers.some((l) => (l.layer === 1 || l.layer === 2) && l.ok),
    jumpCount: bundle.jumpGroups.reduce((s, g) => s + g.links.length, 0),
  };
}
