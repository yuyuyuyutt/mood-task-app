// src/features/plan-generator/services/rag/chunking.ts
// 正文分块（纯函数）。
//
// 为什么需要分块：整页正文动辄上万字，直接塞进 prompt 会挤掉真正重要的约束，
// 而且 7B 模型在长上下文里对中段的注意力最差。做法是"窗口 + 重叠"切块，
// 再用向量只召回与该目标最相关的几块。
//
// 切分细节：
//   - 优先在**句子边界**断开（窗口 60% 之后再找最近的句末符号），避免把一句话切两半；
//   - 相邻块保留 `overlap` 字重叠，防止答案刚好落在切口上；
//   - 单页最多 MAX_CHUNKS 块（防病态页面把索引撑爆）。

/** 单块目标长度（字符） */
export const DEFAULT_CHUNK_SIZE = 500;
/** 相邻块重叠长度（字符） */
export const DEFAULT_CHUNK_OVERLAP = 80;
/** 单页最多切多少块 */
export const MAX_CHUNKS = 40;

export interface TextChunk {
  index: number;
  text: string;
  charCount: number;
}

/** 证据片段的稳定 id：`${resourceId}#${chunkIndex}`（namespace 由向量库负责隔离） */
export function chunkRefId(resourceId: string, index: number): string {
  return `${resourceId}#${index}`;
}

/** 折叠空白：行内多空白压成一个空格，空行压成一个换行 */
export function normalizeWhitespace(text: string): string {
  return text
    .split('\n')
    .map((line) => line.split(/\s+/).filter(Boolean).join(' '))
    .filter((line) => line.length > 0)
    .join('\n')
    .trim();
}

const SENTENCE_END = new Set(['。', '！', '？', '；', '.', '!', '?', ';', '\n']);

/** 返回窗口内最后一个句末符号之后的位置（找不到返回 -1） */
function lastSentenceEnd(window: string): number {
  for (let i = window.length - 1; i >= 0; i--) {
    if (SENTENCE_END.has(window[i])) return i + 1;
  }
  return -1;
}

/**
 * 把正文切成带重叠的块。返回顺序即原文顺序，`index` 可用于拼回 refId。
 * 空文本返回空数组（调用方据此跳过该资源）。
 */
export function chunkText(
  text: string,
  options: { size?: number; overlap?: number; maxChunks?: number } = {},
): TextChunk[] {
  const size = Math.max(120, options.size ?? DEFAULT_CHUNK_SIZE);
  const rawOverlap = Math.max(0, options.overlap ?? DEFAULT_CHUNK_OVERLAP);
  const overlap = Math.min(rawOverlap, Math.floor(size / 2));
  const maxChunks = Math.max(1, options.maxChunks ?? MAX_CHUNKS);

  const clean = normalizeWhitespace(text);
  if (!clean) return [];

  const chunks: TextChunk[] = [];
  let start = 0;
  while (start < clean.length && chunks.length < maxChunks) {
    let end = Math.min(clean.length, start + size);
    if (end < clean.length) {
      const cut = lastSentenceEnd(clean.slice(start, end));
      // 只在"断句位置足够靠后"时才提前断，否则宁可硬切也不要切出过短的块
      if (cut > size * 0.6) end = start + cut;
    }
    const piece = clean.slice(start, end).trim();
    if (piece.length > 0) {
      chunks.push({ index: chunks.length, text: piece, charCount: piece.length });
    }
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}
