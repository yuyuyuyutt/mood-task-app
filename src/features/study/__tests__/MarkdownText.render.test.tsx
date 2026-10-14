// src/features/study/__tests__/MarkdownText.render.test.tsx
// Markdown 渲染的**服务端渲染冒烟**（node 环境，不需要 jsdom）。
// 守住两件事：
//   1) "突出重点"这件事真的渲染成了对应标签（标题 / 加粗 / 代码块 / 列表 / 引用）；
//   2) 正文来自外部网站，**注入不成立** —— 任何 HTML/脚本都只能作为文字显示。
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownText } from '../components/MarkdownText';

const md = [
  '# 总览',
  '',
  '这是**重点**与`行内代码`，还有[外链](https://example.com/x)。',
  '',
  '- 甲',
  '- 乙',
  '',
  '> 引用的一句话',
  '',
  '```python',
  '# 代码里的井号不是标题',
  'x = 1 < 2',
  '```',
].join('\n');

describe('MarkdownText 渲染', () => {
  const html = renderToStaticMarkup(<MarkdownText text={md} />);

  it('标题 / 加粗 / 行内代码 / 代码块 / 列表 / 引用都渲染成对应标签', () => {
    expect(html).toContain('<h3'); // 标题统一渲染成 h3（语义上属于卡片内的小节）
    expect(html).toContain('总览');
    expect(html).toContain('<strong');
    expect(html).toContain('重点');
    expect(html).toContain('<code');
    expect(html).toContain('行内代码');
    expect(html).toContain('<pre');
    expect(html).toContain('# 代码里的井号不是标题'); // 代码块内原样保留
    expect(html).toContain('x = 1 &lt; 2'); // 代码里的 '<' 必须转义
    expect(html).toContain('<ul');
    expect(html).toContain('<li');
    expect(html).toContain('<blockquote');
    expect(html).toContain('引用的一句话');
  });

  it('外链渲染成可点按钮并带上 URL（不跳站内路由）', () => {
    expect(html).toContain('https://example.com/x');
    expect(html).toContain('<button');
    expect(html).not.toContain('href="https://example.com/x"'); // 不生成 <a href>，避免站内跳转
  });

  it('正文里的 HTML / 脚本只能当文字显示（无注入面）', () => {
    const evil = '<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">\n\n[x](javascript:alert(3))';
    const output = renderToStaticMarkup(<MarkdownText text={evil} />);
    // 只会有"转义后的文字"，不会有真正的标签或事件属性
    expect(output).not.toContain('<script');
    expect(output).not.toContain('<img');
    expect(output).not.toContain('onerror="');
    expect(output).toContain('&lt;script&gt;');
    expect(output).toContain('&lt;img src=x');
    // javascript: 链接不生成可点节点（原样作为文字）
    expect(output).not.toContain('<button');
  });

  it('空文本渲染为空，不抛错', () => {
    expect(renderToStaticMarkup(<MarkdownText text="" />)).toBe('<div class="text-ink-2"></div>');
  });
});
