// src/features/study/markdown.ts
// 阅读模式用的 **Markdown 子集解析器**（纯函数）。
//
// 为什么自己写而不再引一个依赖：
//   1) 只需要"看懂重点"这几样：标题 / 加粗 / 斜体 / 删除线 / 行内代码 / 代码块 / 列表 / 引用 / 分隔线 / 链接；
//   2) 必须**产出结构化节点**而不是 HTML 字符串 —— 渲染成 React 元素就没有 XSS 面，
//      不受"正文里恰好写了 <script>"这类问题影响（正文本身来自外部网站，必须当成不可信内容）；
//   3) 解析器是纯函数，可以直接单测（引依赖反而不好断言行为边界）。
//
// 明确的取舍（不假装完整）：不做表格、任务列表、脚注、HTML 内联、嵌套强调的一层级以上解析。
// 遇到不认识的语法就当成普通文本显示 —— 对阅读来说"少渲染一层"远好于"显示成乱七八糟"。

export type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'strong'; value: string }
  | { type: 'em'; value: string }
  | { type: 'del'; value: string }
  | { type: 'code'; value: string }
  | { type: 'link'; value: string; href: string };

export type BlockNode =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: Array<{ depth: number; text: string }> }
  | { type: 'code'; lang: string; code: string }
  | { type: 'quote'; text: string }
  | { type: 'hr' };

/** 单次解析的最大块数（防超大正文把渲染撑爆） */
export const MAX_BLOCKS = 400;
/** 单次解析的最大字符数（超出部分不渲染，已有"只读了前 6000 字"的提示） */
export const MAX_PARSE_CHARS = 20_000;
/** 列表最大缩进层级 */
export const MAX_LIST_DEPTH = 3;

const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^(```+|~~~+)\s*(\S*)\s*$/;
const HR = /^(-{3,}|\*{3,}|_{3,})$/;
const QUOTE = /^>\s?(.*)$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;

/** 只允许 http(s)：`javascript:` / `data:` 一律不生成链接节点 */
export function isSafeHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

/** 解析行内标记（顺序即优先级：加粗优先于斜体） */
export function parseInline(text: string): InlineNode[] {
  const pattern = /(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(\*[^*\n]+\*)|(`[^`\n]+`)|(\[[^\]\n]+\]\(([^)\s]+)\))/g;
  const nodes: InlineNode[] = [];
  let last = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push({ type: 'text', value: text.slice(last, index) });

    const token = match[0];
    if (token.startsWith('**')) {
      nodes.push({ type: 'strong', value: token.slice(2, -2) });
    } else if (token.startsWith('~~')) {
      nodes.push({ type: 'del', value: token.slice(2, -2) });
    } else if (token.startsWith('`')) {
      nodes.push({ type: 'code', value: token.slice(1, -1) });
    } else if (token.startsWith('[')) {
      const label = token.slice(1, token.indexOf(']'));
      const href = (match[6] ?? '').trim();
      // 不安全（javascript: 等）或相对链接：不生成可点节点，但**原样保留原文**，
      // 不做"只留文字"的裁剪 —— 少一次静默改写，就少一次"正文怎么变短了"的困惑
      if (isSafeHttpUrl(href)) nodes.push({ type: 'link', value: label, href });
      else nodes.push({ type: 'text', value: token });
    } else {
      nodes.push({ type: 'em', value: token.slice(1, -1) });
    }
    last = index + token.length;
  }

  if (last < text.length) nodes.push({ type: 'text', value: text.slice(last) });
  return nodes.filter((node) => node.type !== 'text' || node.value.length > 0);
}

/** 解析块级结构 */
export function parseMarkdown(input: string): BlockNode[] {
  const blocks: BlockNode[] = [];
  const lines = input.slice(0, MAX_PARSE_CHARS).replace(/\r\n?/g, '\n').split('\n');
  let paragraph: string[] = [];
  let i = 0;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join('\n').trim();
    if (text) blocks.push({ type: 'paragraph', text });
    paragraph = [];
  };

  while (i < lines.length && blocks.length < MAX_BLOCKS) {
    const line = lines[i];
    const trimmed = line.trim();

    // 代码块：内容原样保留（这是"原网站格式"里最不能变形的一部分）
    const fence = trimmed.match(FENCE);
    if (fence) {
      flushParagraph();
      const marker = fence[1].slice(0, 3);
      const lang = fence[2].slice(0, 16);
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith(marker)) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1; // 跳过结束围栏（缺失时也会被上面的边界挡住）
      blocks.push({ type: 'code', lang, code: code.join('\n').replace(/\s+$/, '') });
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      i += 1;
      continue;
    }

    const heading = trimmed.match(HEADING);
    if (heading) {
      flushParagraph();
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
      i += 1;
      continue;
    }

    if (HR.test(trimmed)) {
      flushParagraph();
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    const quote = line.match(QUOTE);
    if (quote) {
      flushParagraph();
      const parts: string[] = [];
      while (i < lines.length) {
        const current = lines[i].match(QUOTE);
        if (!current) break;
        if (current[1].trim()) parts.push(current[1].trim());
        i += 1;
      }
      blocks.push({ type: 'quote', text: parts.join(' ') });
      continue;
    }

    const item = line.match(LIST_ITEM);
    if (item) {
      flushParagraph();
      const ordered = /\d/.test(item[2]);
      const items: Array<{ depth: number; text: string }> = [];
      while (i < lines.length) {
        const current = lines[i].match(LIST_ITEM);
        if (!current) break;
        // 有序与无序混排时断开成两个列表，避免编号错乱
        if (/\d/.test(current[2]) !== ordered) break;
        const indent = current[1].replace(/\t/g, '  ').length;
        items.push({
          depth: Math.min(MAX_LIST_DEPTH, Math.floor(indent / 2)),
          text: current[3].trim(),
        });
        i += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    paragraph.push(line);
    i += 1;
  }

  flushParagraph();
  return blocks;
}

/** 从块结构还原纯文本（用于字数统计等，不用于检索） */
export function blocksToPlainText(blocks: BlockNode[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case 'heading':
        case 'paragraph':
        case 'quote':
          return block.text;
        case 'list':
          return block.items.map((item) => item.text).join('\n');
        case 'code':
          return block.code;
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n');
}
