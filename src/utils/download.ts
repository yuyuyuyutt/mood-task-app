// src/utils/download.ts
/** 触发浏览器/WebView 下载一个 JSON 文件 */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // 延迟释放，避免部分 WebView 还没读完就失效
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** 复制到剪贴板；不可用时返回 false（调用方给出降级提示） */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
