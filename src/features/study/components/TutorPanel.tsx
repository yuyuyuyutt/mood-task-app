// src/features/study/components/TutorPanel.tsx
// 辅导员面板：只根据当前资源的正文回答，没有依据就直说。
//
// 界面上刻意保留三样东西（都对应产品承诺，不是装饰）：
//   - 引用编号（点开可看被引用的原文片段）→ 答案可核对；
//   - "没有依据"时的原因与下一步 → 用户知道该做什么，而不是以为模型坏了；
//   - 被丢弃的编造引用计数 → 防幻觉不是文案，是有计数的行为。
import React, { useState } from 'react';
import {
  FaRobot,
  FaPaperPlane,
  FaSpinner,
  FaQuoteLeft,
  FaSave,
  FaTrash,
  FaInfoCircle,
  FaExclamationTriangle,
} from 'react-icons/fa';
import type { TutorMessage } from '../types';
import type { TutorAnswer } from '../tutor';

export interface TutorPanelProps {
  resourceTitle?: string;
  /** 为什么现在不能问（没有正文 / 未开模型等），有值时禁用输入 */
  blockedReason?: string;
  messages: TutorMessage[];
  /** 流式输出中的临时文本（还没落进 messages） */
  streaming: string;
  busy: boolean;
  lastResult?: TutorAnswer;
  onAsk: (question: string) => void;
  onSaveAnswer: (text: string) => void;
  onClearThread: () => void;
}

const SUGGESTIONS = ['这条资源的核心结论是什么？', '具体步骤有哪些？', '有哪些容易踩的坑？'];

export const TutorPanel: React.FC<TutorPanelProps> = ({
  resourceTitle,
  blockedReason,
  messages,
  streaming,
  busy,
  lastResult,
  onAsk,
  onSaveAnswer,
  onClearThread,
}) => {
  const [draft, setDraft] = useState('');
  const [expandedCitation, setExpandedCitation] = useState<string | null>(null);

  const submit = () => {
    const question = draft.trim();
    if (!question || busy || blockedReason) return;
    setDraft('');
    onAsk(question);
  };

  return (
    <div className="card flex min-h-[22rem] flex-col p-5">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <FaRobot className="text-[11px] text-ink-3" />
          学习辅导员
        </h2>
        {messages.length > 0 && (
          <button type="button" onClick={onClearThread} title="清空本资源的对话" className="icon-btn">
            <FaTrash className="text-[10px]" />
          </button>
        )}
      </div>
      <p className="mt-0.5 text-[11px] text-ink-3">
        {resourceTitle ? `只依据「${resourceTitle}」的正文回答，带引用编号` : '从左侧选一条资源后再提问'}
      </p>

      {blockedReason && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-warn-soft p-3">
          <FaInfoCircle className="mt-0.5 text-[11px] text-warn" />
          <p className="text-xs leading-5 text-ink-2">{blockedReason}</p>
        </div>
      )}

      {/* 对话 */}
      <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {messages.length === 0 && !streaming && !blockedReason && (
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setDraft(s)}
                className="chip text-[11px]"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={
              message.role === 'user'
                ? 'ml-6 rounded-lg bg-brand-soft/50 px-3 py-2 text-[12px] leading-5 text-ink'
                : 'rounded-lg bg-surface-2 px-3 py-2'
            }
          >
            <p className="text-[12px] leading-5 whitespace-pre-wrap text-ink-2">{message.content}</p>
            {message.role === 'assistant' && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {(message.citations ?? []).map((id) => (
                  <span
                    key={id}
                    className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-ink-3"
                    title="答案依据的片段编号"
                  >
                    {id}
                  </span>
                ))}
                <button
                  type="button"
                  onClick={() => onSaveAnswer(message.content)}
                  className="ml-auto inline-flex items-center gap-1 text-[10px] text-ink-3 hover:text-ink"
                >
                  <FaSave className="text-[9px]" />
                  存为笔记
                </button>
              </div>
            )}
          </div>
        ))}

        {streaming && (
          <div className="rounded-lg bg-surface-2 px-3 py-2">
            <p className="text-[12px] leading-5 whitespace-pre-wrap text-ink-2">{streaming}</p>
            <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-ink-3">
              <FaSpinner className="animate-spin text-[9px]" />
              生成中…
            </span>
          </div>
        )}

        {/* 拒绝回答 / 失败时，把原因和引用核对都摆出来 */}
        {lastResult && lastResult.status !== 'answered' && (
          <div className="flex items-start gap-2 rounded-lg border border-line p-3">
            <FaExclamationTriangle className="mt-0.5 text-[11px] text-warn" />
            <div>
              <p className="text-[12px] font-medium text-ink">
                {lastResult.status === 'no_evidence' ? '没有依据，所以不回答' : '这次没能完成'}
              </p>
              <p className="mt-1 text-[11px] leading-5 text-ink-3">{lastResult.reason}</p>
            </div>
          </div>
        )}

        {lastResult?.status === 'answered' && lastResult.citations.length > 0 && (
          <div className="rounded-lg border border-line p-2.5">
            <p className="text-[10px] text-ink-3">答案依据（点击展开原文片段）</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {lastResult.citations.map((citation) => (
                <button
                  key={citation.id}
                  type="button"
                  onClick={() => setExpandedCitation(expandedCitation === citation.id ? null : citation.id)}
                  className="chip text-[10px]"
                >
                  <FaQuoteLeft className="text-[8px]" />
                  {citation.id}
                </button>
              ))}
            </div>
            {expandedCitation && (
              <p className="mt-2 max-h-32 overflow-y-auto rounded bg-surface-2 p-2 text-[11px] leading-5 whitespace-pre-wrap text-ink-3">
                {lastResult.citations.find((c) => c.id === expandedCitation)?.text}
              </p>
            )}
            {lastResult.droppedCitations > 0 && (
              <p className="mt-2 text-[10px] text-warn">
                模型还标了 {lastResult.droppedCitations} 处找不到的引用，已按白名单忽略。
              </p>
            )}
          </div>
        )}
      </div>

      {/* 输入 */}
      <div className="mt-3 flex items-end gap-2 border-t border-line pt-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={Boolean(blockedReason)}
          rows={2}
          placeholder={blockedReason ? '先满足上面的条件才能提问' : '问这条资源里的内容（Enter 发送，Shift+Enter 换行）'}
          className="input min-h-[2.5rem] flex-1 resize-none text-[12px] disabled:opacity-60"
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy || !draft.trim() || Boolean(blockedReason)}
          className="btn btn-primary btn-sm disabled:opacity-50"
        >
          {busy ? <FaSpinner className="animate-spin text-[10px]" /> : <FaPaperPlane className="text-[10px]" />}
          提问
        </button>
      </div>
    </div>
  );
};
