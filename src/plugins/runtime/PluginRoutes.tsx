// src/plugins/runtime/PluginRoutes.tsx
// 插件页面路由生成：把"已启用的页面能力插件"转换为 React Router 的 <Route> 元素数组。
// ⚠️ 注意：React Router 只允许 <Route> 或 <React.Fragment> 作为 <Routes> 的直接子元素，
// 自定义组件（即使内部渲染的是 <Route>）会直接抛错（"[X] is not a <Route> component"）。
// 因此这里不导出组件，而是导出 usePluginRoutes() hook：调用方在 <Routes> 内
// 用 {usePluginRoutes()} 展开为真正的 <Route> 元素。
// 安全模型：只渲染页面注册表（PAGE_RENDERERS）中登记过的 pageId；
// 未登记的 pageId 渲染为安全占位页（不执行任何插件代码）。
import React, { Suspense } from 'react';
import { Route } from 'react-router-dom';
import { FaExclamationTriangle, FaSpinner } from 'react-icons/fa';
import { getPageRenderer } from './pages';
import { usePluginHost } from './context';

/** 未注册渲染器的页面占位（安全兜底，防 404 也防注入） */
const UnknownPagePlaceholder: React.FC<{ title: string }> = ({ title }) => (
  <div className="max-w-3xl mx-auto p-8 text-center">
    <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-8">
      <FaExclamationTriangle className="w-10 h-10 text-yellow-500 mx-auto mb-4" />
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">{title}</h2>
      <p className="text-gray-600 dark:text-gray-400 text-sm">
        该插件声明的页面（pageId）在宿主页面注册表中不存在，已安全忽略其内容。
        插件清单不携带可执行代码，此占位页不会执行任何插件提供的内容。
      </p>
    </div>
  </div>
);

const PageSuspense: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Suspense
    fallback={
      <div className="flex items-center justify-center h-64">
        <FaSpinner className="w-8 h-8 text-primary-500 animate-spin" />
      </div>
    }
  >
    {children}
  </Suspense>
);

/**
 * 生成插件贡献页面的 <Route> 元素数组。
 * 在 <Routes> 内以 {usePluginRoutes()} 形式展开（必须是 hook 返回值，
 * 不能包装成自定义组件再放进 <Routes>）。
 * pageId 冲突时先启用者生效（按安装顺序）。
 */
export function usePluginRoutes(): React.ReactElement[] {
  const { pages } = usePluginHost();
  const seen = new Set<string>();
  const routes: React.ReactElement[] = [];

  for (const page of pages) {
    if (seen.has(page.pageId)) continue; // 同 pageId 只挂载第一个（防冲突）
    seen.add(page.pageId);
    const Renderer = getPageRenderer(page.pageId);
    routes.push(
      <Route
        key={page.pluginId}
        path={page.path}
        element={
          <PageSuspense>
            {Renderer ? (
              <Renderer />
            ) : (
              <UnknownPagePlaceholder title={page.title} />
            )}
          </PageSuspense>
        }
      />,
    );
  }

  return routes;
}
