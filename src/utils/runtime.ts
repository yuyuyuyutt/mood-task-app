// src/utils/runtime.ts
/** 当前是否运行在 Tauri 桌面端（WebView）内；浏览器开发环境返回 false */
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
