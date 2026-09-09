// src/plugins/runtime/pages.tsx
// 页面渲染器注册表（安全白名单）。
// 安全模型：插件清单的 capabilities.page.pageId 必须命中这里的注册表，
// 宿主才会渲染对应组件；未注册的 pageId 渲染为安全占位页。
// 插件清单本身永远无法携带/执行组件代码——页面组件全部来自受信任的主应用包。
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const MoodDiaryPage = lazy(() =>
  import('../pages/MoodDiaryPage').then((m) => ({ default: m.MoodDiaryPage })),
);

/** pageId -> 内置渲染器（懒加载，避免影响首屏包体） */
export const PAGE_RENDERERS: Record<string, LazyExoticComponent<ComponentType>> = {
  'mood-diary': MoodDiaryPage,
};

export function getPageRenderer(pageId: string): LazyExoticComponent<ComponentType> | undefined {
  return PAGE_RENDERERS[pageId];
}

export function isKnownPage(pageId: string): boolean {
  return Object.prototype.hasOwnProperty.call(PAGE_RENDERERS, pageId);
}
