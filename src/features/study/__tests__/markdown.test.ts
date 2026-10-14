// src/features/study/__tests__/markdown.test.ts
// Markdown 子集解析器：只测"阅读模式真正依赖的行为"，并把**不做的部分**也钉成用例，
// 避免以后有人以为它支持表格/HTML 内联而写出依赖。
import { describe, expect, it } from 'vitest';
import {
  MAX_LIST_DEPTH,
  blocksToPlainText,
  isSafeHttpUrl,
  parseInline,
  parseMarkdown,
} from '../markdown';

describe('markdown：块级解析', () => {
  it('标题按层级解析，正文行合并成段落', () => {
    const blocks = parseMarkdown('# 总览\n\n## 细节\n第一行\n第二行');
    expect(blocks[0]).toEqual({ type: 'heading', level: 1, text: '总览' });
    expect(blocks[1]).toEqual({ type: 'heading', level: 2, text: '细节' });
    // 段落内保留换行（阅读时行距已经很大，再合并会变成一坨）
    expect(blocks[2]).toEqual({ type: 'paragraph', text: '第一行\n第二行' });
  });

  it('列表：有序 / 无序分别解析，缩进变成层级并封顶', () => {
    const unordered = parseMarkdown('- 甲\n- 乙\n  - 子项');
    expect(unordered[0]).toMatchObject({ type: 'list', ordered: false });
    const items = (unordered[0] as { items: Array<{ depth: number; text: string }> }).items;
    expect(items.map((item) => item.text)).toEqual(['甲', '乙', '子项']);
    expect(items[2].depth).toBe(1);

    const ordered = parseMarkdown('1. 第一\n2. 第二');
    expect(ordered[0]).toMatchObject({ type: 'list', ordered: true });

    // 混排时断开成两个列表（否则编号会串）
    const mixed = parseMarkdown('- 甲\n1. 第一');
    expect(mixed).toHaveLength(2);

    // 层级封顶，避免深层缩进把正文挤没
    const deep = parseMarkdown(`${' '.repeat(20)}- 很深`);
    expect((deep[0] as { items: Array<{ depth: number }> }).items[0].depth).toBe(MAX_LIST_DEPTH);
  });

  it('围栏代码块原样保留（里面的 # 与 - 不当成标题/列表）', () => {
    const blocks = parseMarkdown('```python\n# 这是注释\nx = [i for i in range(3)]\n```');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      type: 'code',
      lang: 'python',
      code: '# 这是注释\nx = [i for i in range(3)]',
    });
  });

  it('围栏未闭合时吃到文末（不丢内容、不死循环）', () => {
    const blocks = parseMarkdown('```\nconst a = 1;\nconst b = 2;');
    expect(blocks[0]).toEqual({ type: 'code', lang: '', code: 'const a = 1;\nconst b = 2;' });
  });

  it('引用合并为一段；分隔线单独成块', () => {
    const blocks = parseMarkdown('> 第一句\n> 第二句\n\n---\n\n正文');
    expect(blocks[0]).toEqual({ type: 'quote', text: '第一句 第二句' });
    expect(blocks[1]).toEqual({ type: 'hr' });
    expect(blocks[2]).toEqual({ type: 'paragraph', text: '正文' });
  });

  it('空输入与纯空行不产生块', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('\n\n   \n')).toEqual([]);
  });

  it('blocksToPlainText 汇总文字（用于统计，不用于检索）', () => {
    const plain = blocksToPlainText(
      parseMarkdown('# 标题\n\n正文\n\n- 甲\n- 乙\n\n```\ncode\n```'),
    );
    expect(plain).toContain('标题');
    expect(plain).toContain('甲');
    expect(plain).toContain('code');
  });
});

describe('markdown：行内解析', () => {
  it('加粗 / 斜体 / 删除线 / 行内代码', () => {
    expect(parseInline('这是**重点**')).toEqual([
      { type: 'text', value: '这是' },
      { type: 'strong', value: '重点' },
    ]);
    expect(parseInline('*斜*')).toEqual([{ type: 'em', value: '斜' }]);
    expect(parseInline('~~过时~~')).toEqual([{ type: 'del', value: '过时' }]);
    expect(parseInline('`f(x)`')).toEqual([{ type: 'code', value: 'f(x)' }]);
  });

  it('加粗优先于斜体（`**` 不会被当成两个 `*`）', () => {
    expect(parseInline('**强**')).toEqual([{ type: 'strong', value: '强' }]);
  });

  it('链接只接受 http(s)，其余原样保留为文字', () => {
    expect(parseInline('[站内](https://example.com/x)')).toEqual([
      { type: 'link', value: '站内', href: 'https://example.com/x' },
    ]);

    // 相对链接 / javascript: 不生成可点节点，但**原文不丢**（拼回来应与输入一致）
    const relative = parseInline('[相对](/a/b)');
    expect(relative.some((node) => node.type === 'link')).toBe(false);
    expect(relative.map((node) => (node.type === 'text' ? node.value : '')).join('')).toBe(
      '[相对](/a/b)',
    );

    const unsafe = parseInline('[坏](javascript:alert(1))');
    expect(unsafe.some((node) => node.type === 'link')).toBe(false);
    expect(unsafe.map((node) => (node.type === 'text' ? node.value : '')).join('')).toBe(
      '[坏](javascript:alert(1))',
    );

    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('data:text/html,x')).toBe(false);
    expect(isSafeHttpUrl('http://example.com')).toBe(true);
    expect(isSafeHttpUrl('https://example.com')).toBe(true);
  });

  it('未闭合的标记原样保留（宁可不渲染，也不要吞字符）', () => {
    expect(parseInline('未闭合 **重点')).toEqual([{ type: 'text', value: '未闭合 **重点' }]);
    expect(parseInline('单个 * 号')).toEqual([{ type: 'text', value: '单个 * 号' }]);
  });
});
