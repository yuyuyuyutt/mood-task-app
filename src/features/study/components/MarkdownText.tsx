// src/features/study/components/MarkdownText.tsx
// 把 Markdown 子集渲染成**阅读优先**的排版。
//
// 三个刻意选择：
//   1) **不用 dangerouslySetInnerHTML**：正文来自外部网站，必须当不可信内容处理；
//      这里直接把解析结果映射成 React 元素，从构造上就没有注入面；
//   2) 字号用 em（跟随阅读模式的字号倍率），行宽由外层限制在 ~68 字符 —— 长行是阅读体验的头号杀手；
//   3) 只做"让重点看得出来"的层级：标题更大更黑、加粗更重、代码有底色、引用有竖线；
//      不做花哨配色，避免重点太多等于没有重点。
import React, { useMemo } from 'react';
import { FaExternalLinkAlt } from 'react-icons/fa';
import { openExternal } from '../../../utils/openExternal';
import { parseInline, parseMarkdown, type BlockNode, type InlineNode } from '../markdown';

export interface MarkdownTextProps {
  text: string;
  /** 链接点击回调（默认走系统浏览器打开） */
  onOpenLink?: (url: string) => void;
}

const HEADING_CLASS: Record<number, string> = {
  1: 'text-[1.5em] font-semibold text-ink mt-7 mb-2.5 first:mt-0',
  2: 'text-[1.28em] font-semibold text-ink mt-6 mb-2 first:mt-0',
  3: 'text-[1.14em] font-semibold text-ink mt-5 mb-1.5 first:mt-0',
  4: 'text-[1.02em] font-semibold text-ink mt-4 mb-1.5 first:mt-0',
  5: 'text-[1em] font-semibold text-ink-2 mt-4 mb-1',
  6: 'text-[0.95em] font-semibold text-ink-3 mt-4 mb-1',
};

const Inline: React.FC<{ nodes: InlineNode[]; onOpenLink?: (url: string) => void }> = ({
  nodes,
  onOpenLink,
}) => (
  <>
    {nodes.map((node, index) => {
      switch (node.type) {
        case 'strong':
          return (
            <strong key={index} className="font-semibold text-ink">
              {node.value}
            </strong>
          );
        case 'em':
          return (
            <em key={index} className="text-ink italic">
              {node.value}
            </em>
          );
        case 'del':
          return (
            <del key={index} className="text-ink-3">
              {node.value}
            </del>
          );
        case 'code':
          return (
            <code
              key={index}
              className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[0.88em] text-ink"
            >
              {node.value}
            </code>
          );
        case 'link':
          return (
            <button
              key={index}
              type="button"
              onClick={() => (onOpenLink ? onOpenLink(node.href) : void openExternal(node.href))}
              title={node.href}
              className="inline-flex items-baseline gap-0.5 text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
            >
              {node.value}
              <FaExternalLinkAlt className="text-[0.7em] opacity-70" />
            </button>
          );
        default:
          return <React.Fragment key={index}>{node.value}</React.Fragment>;
      }
    })}
  </>
);

const Block: React.FC<{ block: BlockNode; onOpenLink?: (url: string) => void }> = ({
  block,
  onOpenLink,
}) => {
  switch (block.type) {
    case 'heading':
      return (
        <h3 className={HEADING_CLASS[block.level] ?? HEADING_CLASS[4]}>
          <Inline nodes={parseInline(block.text)} onOpenLink={onOpenLink} />
        </h3>
      );
    case 'paragraph':
      return (
        <p className="my-3 leading-[1.9] whitespace-pre-line text-ink-2">
          <Inline nodes={parseInline(block.text)} onOpenLink={onOpenLink} />
        </p>
      );
    case 'list':
      return (
        <ul className={`my-3 space-y-1 pl-5 leading-[1.85] text-ink-2 ${block.ordered ? 'list-decimal' : 'list-disc'}`}>
          {block.items.map((item, index) => (
            <li key={index} style={item.depth > 0 ? { marginLeft: item.depth * 14 } : undefined}>
              <Inline nodes={parseInline(item.text)} onOpenLink={onOpenLink} />
            </li>
          ))}
        </ul>
      );
    case 'code':
      return (
        <div className="my-3">
          {block.lang && <div className="mb-1 font-mono text-[0.75em] text-ink-3">{block.lang}</div>}
          <pre className="overflow-x-auto rounded-lg bg-surface-3 p-3 font-mono text-[0.86em] leading-6 text-ink-2">
            <code>{block.code}</code>
          </pre>
        </div>
      );
    case 'quote':
      return (
        <blockquote className="my-3 border-l-2 border-brand/40 pl-3 text-ink-3">
          <Inline nodes={parseInline(block.text)} onOpenLink={onOpenLink} />
        </blockquote>
      );
    case 'hr':
      return <hr className="my-6 border-line" />;
    default:
      return null;
  }
};

export const MarkdownText: React.FC<MarkdownTextProps> = ({ text, onOpenLink }) => {
  const blocks = useMemo(() => parseMarkdown(text), [text]);

  return (
    <div className="text-ink-2">
      {blocks.map((block, index) => (
        <Block key={index} block={block} onOpenLink={onOpenLink} />
      ))}
    </div>
  );
};
