// src/features/study/components/StudyNotesCard.tsx
// 速记（侧栏）：学到一半想到的东西不能丢，但要能在 5 秒内记完。
//
// 与"正文"的区别（也是隐私口径的区别）：笔记是**用户自己写的内容**，
// 存在 `__study` 命名空间里随备份导出；正文是抓来的派生数据，只缓存 7 天、不进备份。
import React, { useState } from 'react';
import { FaStickyNote, FaTrash, FaSave } from 'react-icons/fa';
import type { StudyNote } from '../types';

export interface StudyNotesCardProps {
  notes: StudyNote[];
  /** 当前资源 / 任务的上下文，保存时自动带上，便于以后回溯 */
  context?: { resourceId?: string; resourceTitle?: string; taskId?: number };
  onSave: (note: StudyNote) => void;
  onDelete: (id: string) => void;
  /** 由页面提供（点"存为笔记"时也会用到） */
  makeId: () => string;
}

function timeLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export const StudyNotesCard: React.FC<StudyNotesCardProps> = ({
  notes,
  context,
  onSave,
  onDelete,
  makeId,
}) => {
  const [draft, setDraft] = useState('');

  const submit = () => {
    const body = draft.trim();
    if (!body) return;
    const now = new Date().toISOString();
    // 标题取第一行（最长 24 字）：速记不该逼用户先起标题
    const title = body.split('\n')[0].slice(0, 24);
    onSave({
      id: makeId(),
      createdAt: now,
      updatedAt: now,
      title,
      body,
      tags: [],
      resourceId: context?.resourceId,
      resourceTitle: context?.resourceTitle,
      taskId: context?.taskId,
    });
    setDraft('');
  };

  return (
    <div className="card p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        <FaStickyNote className="text-[11px] text-ink-3" />
        速记
      </h3>

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        rows={3}
        placeholder={'想到什么就先写下来（Ctrl/⌘+Enter 保存）'}
        className="input mt-2 text-[12px]"
      />
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[10px] text-ink-3">
          {context?.resourceTitle ? `归属：${context.resourceTitle}` : '未绑定资源'}
        </span>
        <button type="button" onClick={submit} disabled={!draft.trim()} className="btn btn-primary btn-sm disabled:opacity-50">
          <FaSave className="text-[10px]" />
          保存
        </button>
      </div>

      {notes.length > 0 && (
        <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto border-t border-line pt-3">
          {notes.map((note) => (
            <li key={note.id} className="group rounded-lg bg-surface-2 px-2.5 py-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[12px] leading-5 whitespace-pre-wrap text-ink-2">{note.body}</p>
                <button
                  type="button"
                  onClick={() => onDelete(note.id)}
                  title="删除"
                  className="icon-btn shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
                >
                  <FaTrash className="text-[10px]" />
                </button>
              </div>
              <p className="mt-1 text-[10px] text-ink-3">
                {timeLabel(note.updatedAt)}
                {note.resourceTitle ? ` · ${note.resourceTitle}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-[10px] text-ink-3">
        笔记保存在本机，并随「数据备份」导出（正文缓存不进备份）。
      </p>
    </div>
  );
};
