// src/utils/openExternal.ts
// 统一的外链打开方式。
// 背景：Tauri WebView 里 `target="_blank"` 的 <a> 通常不会打开系统浏览器，
// 需要交给 opener 插件；浏览器开发环境则回退到 window.open。
import { isTauriRuntime } from './runtime';

/** 只允许 http(s)，避免把自定义协议/脚本 URL 透传给系统  */
function isSafeUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export function openExternal(url: string): void {
  if (!isSafeUrl(url)) {
    console.warn('[openExternal] 仅允许 http(s) 链接，已忽略:', url);
    return;
  }
  if (!isTauriRuntime()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  // 动态导入：浏览器端不会把 opener 插件打进主包
  void import('@tauri-apps/plugin-opener')
    .then(({ openUrl }) => openUrl(url))
    .catch((err) => {
      console.warn('[openExternal] opener 插件不可用，回退 window.open:', err);
      window.open(url, '_blank', 'noopener,noreferrer');
    });
}

/** <a> 上的统一 onClick：保留 href（可右键复制/悬停看地址），但拦截默认跳转 */
export function handleExternalLink(event: { preventDefault: () => void }, url: string): void {
  event.preventDefault();
  openExternal(url);
}
