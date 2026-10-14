// src/features/study/id.ts
// 本地 id 生成：会话 / 笔记 / 消息都用它。
//
// 为什么不用 crypto.randomUUID：桌面 WebView 与浏览器开发模式都可用，但
// 这个应用的 id 只需要"本机唯一 + 可读前缀 + 可排序"，用时间戳 + 随机后缀更简单，
// 也便于在调试时一眼看出是什么类型的记录（session-xxx / note-xxx / m-xxx）。
export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
