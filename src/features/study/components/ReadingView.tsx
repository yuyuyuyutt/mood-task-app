// src/features/study/components/ReadingView.tsx
// 应用内阅读模式：**阅读优先**的排版 + 读不到时给出可执行的原因。
//
// 两条设计主线：
//   1) 视觉以正文为主：外层卡片只留一条极窄的工具条，正文限宽 ~68 字符、
//      行高 1.9、字号可调；进入"专注阅读"后正文占满主区（页面上其它面板让位）。
//   2) 保留原网站的 Markdown 结构（标题/加粗/列表/代码/引用/链接）——
//      在 Rust 侧就从 HTML 转换而来（见 `src-tauri/src/content.rs` 的 `html_to_markdown`），
//      渲染走 `MarkdownText`（React 元素，不走 innerHTML，无注入面）。
//
// 约束照旧如实呈现：只读白名单域名、正文来自 7 天缓存或本次抓取、单页最多 6000 字、
// 浏览器直连分支拿不到 Markdown（会明确告诉你"当前是纯文本模式"）。
import React, { useMemo, useState } from 'react';
import {
  FaBookOpen,
  FaExternalLinkAlt,
  FaSyncAlt,
  FaSpinner,
  FaExclamationTriangle,
  FaKey,
  FaMinus,
  FaPlus,
  FaExpandArrowsAlt,
  FaCompressArrowsAlt,
} from 'react-icons/fa';
import { openExternal } from '../../../utils/openExternal';
import { toParagraphs } from '../reading';
import { MarkdownText } from './MarkdownText';
import type { ReadingOutcome } from '../types';

export interface ReadingViewProps {
  resourceTitle?: string;
  resourceUrl?: string;
  outcome: ReadingOutcome | null;
  busy: boolean;
  /** 专注阅读：正文占满主区、字号更舒适、其它面板让位 */
  focus: boolean;
  onToggleFocus: (focus: boolean) => void;
  onOpen: () => void;
  /** 把域名加入抓取白名单（由页面写设置，组件不碰存储） */
  onWhitelist: (domain: string) => void;
}

const STATUS_LABEL: Record<ReadingOutcome['status'], string> = {
  cache: '本机缓存',
  fetched: '刚刚抓取',
  disabled: '未开启',
  blocked: '不在白名单',
  failed: '抓取失败',
};

export const ReadingView: React.FC<ReadingViewProps> = ({
  resourceTitle,
  resourceUrl,
  outcome,
  busy,
  focus,
  onToggleFocus,
  onOpen,
  onWhitelist,
}) => {
  const [fontScale, setFontScale] = useState(1);
  const paragraphs = useMemo(() => (outcome ? toParagraphs(outcome.text) : []), [outcome]);
  const hasText = Boolean(outcome?.text);
  const hasMarkdown = Boolean(outcome?.markdown);

  return (
    <div className={`card flex flex-col ${focus ? 'p-4 sm:p-6' : 'p-5'}`}>
      {/* 工具条：只占一行，视觉重心留给正文 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <FaBookOpen className="shrink-0 text-[11px] text-ink-3" />
          <span className="truncate text-[13px] font-medium text-ink">
            {outcome?.title || resourceTitle || '从左侧选一条资源开始'}
          </span>
          {outcome && (
            <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-ink-3">
              {STATUS_LABEL[outcome.status]}
              {outcome.text ? ` · ${outcome.text.length} 字` : ''}
              {hasMarkdown ? ' · 已还原格式' : outcome.text ? ' · 纯文本' : ''}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            title="缩小字号"
            onClick={() => setFontScale((s) => Math.max(0.85, Number((s - 0.1).toFixed(2))))}
            className="icon-btn"
          >
            <FaMinus className="text-[10px]" />
          </button>
          <button
            type="button"
            title="放大字号"
            onClick={() => setFontScale((s) => Math.min(1.5, Number((s + 0.1).toFixed(2))))}
            className="icon-btn"
          >
            <FaPlus className="text-[10px]" />
          </button>
          <button
            type="button"
            onClick={onOpen}
            disabled={busy || !resourceUrl}
            title="读取 / 重新抓取正文"
            className="icon-btn disabled:opacity-40"
          >
            {busy ? <FaSpinner className="animate-spin text-[11px]" /> : <FaSyncAlt className="text-[10px]" />}
          </button>
          {resourceUrl && (
            <button
              type="button"
              onClick={() => void openExternal(resourceUrl)}
              title="在浏览器打开"
              className="icon-btn"
            >
              <FaExternalLinkAlt className="text-[10px]" />
            </button>
          )}
          {/* 阅读模式的主控：进出"专注阅读" */}
          <button
            type="button"
            onClick={() => onToggleFocus(!focus)}
            title={focus ? '退出专注阅读' : '专注阅读（正文占满主区）'}
            data-active={focus}
            className="chip ml-1 text-[11px]"
          >
            {focus ? <FaCompressArrowsAlt className="text-[10px]" /> : <FaExpandArrowsAlt className="text-[10px]" />}
            {focus ? '退出专注' : '专注阅读'}
          </button>
        </div>
      </div>

      {/* 读不到时的引导：每一步都能点 */}
      {outcome && !hasText ? (
        <div className="mt-4 rounded-lg border border-line bg-surface-2 p-4">
          <div className="flex items-start gap-2">
            <FaExclamationTriangle className="mt-0.5 text-xs text-warn" />
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-ink">
                {outcome.status === 'failed' ? '没抓到正文' : '还不能在这里读'}
              </p>
              <p className="mt-1 text-xs leading-5 text-ink-3">{outcome.reason}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {outcome.domain && outcome.status !== 'disabled' && (
                  <button
                    type="button"
                    onClick={() => onWhitelist(outcome.domain)}
                    className="btn btn-primary btn-sm"
                  >
                    <FaKey className="text-[10px]" />
                    把 {outcome.domain} 加入白名单
                  </button>
                )}
                <a href="#/settings" className="btn btn-ghost btn-sm">
                  打开设置（语义检索 → 正文抓取）
                </a>
                {resourceUrl && (
                  <button
                    type="button"
                    onClick={() => void openExternal(resourceUrl)}
                    className="btn btn-ghost btn-sm"
                  >
                    <FaExternalLinkAlt className="text-[10px]" />
                    在浏览器打开
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* 正文：限宽 + 大行高；专注模式下更高更宽 */}
      <div className={`mt-4 min-h-0 flex-1 overflow-y-auto pr-1 ${focus ? 'min-h-[62vh]' : ''}`}>
        {!hasText ? (
          <p className="text-xs text-ink-3">
            点工具条上的刷新按钮读取正文（只抓白名单域名，正文仅在本机缓存 7 天、不进备份）。
          </p>
        ) : (
          <div
            className="mx-auto max-w-[68ch]"
            style={{ fontSize: `${(fontScale * (focus ? 1.06 : 1)).toFixed(2)}rem`, lineHeight: 1.9 }}
          >
            {hasMarkdown ? (
              <MarkdownText text={outcome?.markdown ?? ''} />
            ) : (
              <article className="space-y-3 text-ink-2">
                {paragraphs.map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
              </article>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-3">
        <span>
          {hasMarkdown
            ? '已按原网站格式还原标题 / 重点 / 列表 / 代码块'
            : hasText
              ? '当前是纯文本模式（桌面端读取可保留标题与重点格式）'
              : '只抓白名单域名；正文仅在本机缓存 7 天'}
        </span>
        {outcome?.truncated && <span className="text-warn">正文过长，只读取了前 6000 字（可在浏览器看完整内容）</span>}
      </div>
    </div>
  );
};
