// src/features/plan-generator/services/resources/jumpLinks.ts
// 第三层（默认启用，兜底）：平台跳转按钮。
// 不抓取任何数据，只按关键词生成各平台的搜索结果页链接；纯函数、无需联网。
import type { JumpLink, JumpLinkGroup, SearchKeyword } from '../../types';

interface PlatformTemplate {
  platform: string;
  label: string;
  /** {kw} 会被替换为 encodeURIComponent(keyword) */
  template: string;
}

/** 支持的平台与 URL 模板（来自需求定义） */
export const JUMP_PLATFORMS: PlatformTemplate[] = [
  { platform: 'bilibili', label: 'B 站', template: 'https://search.bilibili.com/all?keyword={kw}' },
  { platform: 'douban', label: '豆瓣', template: 'https://www.douban.com/search?q={kw}' },
  { platform: 'xiaohongshu', label: '小红书', template: 'https://www.xiaohongshu.com/search_result?keyword={kw}' },
  { platform: 'douyin', label: '抖音', template: 'https://www.douyin.com/search/{kw}' },
  { platform: 'zhihu', label: '知乎', template: 'https://www.zhihu.com/search?type=content&q={kw}' },
  { platform: 'juejin', label: '掘金', template: 'https://juejin.cn/search?query={kw}' },
];

/** 单个关键词 -> 一组平台跳转按钮 */
export function buildJumpLinks(keyword: string): JumpLink[] {
  const kw = keyword.trim();
  if (!kw) return [];
  const encoded = encodeURIComponent(kw);
  return JUMP_PLATFORMS.map((p) => ({
    platform: p.platform,
    label: p.label,
    url: p.template.replace('{kw}', encoded),
  }));
}

/** 多关键词 -> 分组跳转按钮（去重关键词并按优先级顺序） */
export function buildJumpLinkGroups(keywords: SearchKeyword[] | string[]): JumpLinkGroup[] {
  const list = keywords.map((k) => (typeof k === 'string' ? k : k.keyword)).map((k) => k.trim());
  const seen = new Set<string>();
  const groups: JumpLinkGroup[] = [];
  for (const kw of list) {
    if (!kw || seen.has(kw)) continue;
    seen.add(kw);
    groups.push({ keyword: kw, links: buildJumpLinks(kw) });
  }
  return groups;
}
