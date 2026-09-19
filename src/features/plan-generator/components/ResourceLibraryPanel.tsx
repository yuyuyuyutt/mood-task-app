// src/features/plan-generator/components/ResourceLibraryPanel.tsx
// 资源库管理：用户手动添加自己的资源（本地保存，不联网）。
import React, { useState } from 'react';
import { FaPlus, FaTrash, FaLink, FaSpinner } from 'react-icons/fa';
import { useResourceLibrary } from '../hooks/useResourceLibrary';
import { handleExternalLink } from '../../../utils/openExternal';
import type { ResourceType } from '../types';

const TYPE_OPTIONS: Array<{ value: ResourceType; label: string }> = [
  { value: 'video', label: '视频' },
  { value: 'article', label: '文章' },
  { value: 'book', label: '书籍' },
  { value: 'post', label: '帖子/仓库' },
  { value: 'link', label: '其他链接' },
];

export const ResourceLibraryPanel: React.FC<{ onChanged?: () => void }> = ({ onChanged }) => {
  const { resources, loading, add, remove } = useResourceLibrary();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [type, setType] = useState<ResourceType>('article');
  const [keywords, setKeywords] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await add({
        title,
        url,
        type,
        keywords: keywords.split(/[,，\s]+/).filter(Boolean),
      });
      setTitle('');
      setUrl('');
      setKeywords('');
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm bg-gray-50 dark:bg-gray-800/70 hover:bg-gray-100 dark:hover:bg-gray-700/60 transition-colors"
      >
        <span className="flex items-center text-gray-600 dark:text-gray-300">
          <FaLink className="w-3.5 h-3.5 mr-2 text-gray-400" />
          我的资源库
          <span className="ml-2 text-xs text-gray-400">{resources.length} 条 · 本地保存</span>
        </span>
        <span className="text-xs text-gray-400">{open ? '收起' : '管理'}</span>
      </button>

      {open && (
        <div className="px-4 py-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="资源标题（如：Python 官方教程）"
              className="px-2.5 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-xs text-gray-800 dark:text-gray-200"
            />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              className="px-2.5 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-xs font-mono text-gray-800 dark:text-gray-200"
            />
            <select
              value={type}
              onChange={(e) => setType(e.target.value as ResourceType)}
              className="px-2.5 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-xs text-gray-800 dark:text-gray-200"
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="适用关键词（逗号分隔，可留空）"
              className="px-2.5 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-xs text-gray-800 dark:text-gray-200"
            />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button
            onClick={() => void submit()}
            disabled={busy}
            className="inline-flex items-center px-3 py-2 rounded-lg bg-gray-900 dark:bg-gray-600 text-white text-xs disabled:opacity-60"
          >
            {busy ? <FaSpinner className="w-3 h-3 mr-1.5 animate-spin" /> : <FaPlus className="w-3 h-3 mr-1.5" />}
            添加资源
          </button>

          {!loading && resources.length > 0 && (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700 text-xs">
              {resources.slice(0, 8).map((r) => (
                <li key={r.id} className="py-2 flex items-center gap-2">
                  <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                    {r.type}
                  </span>
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    onClick={(e) => handleExternalLink(e, r.url)}
                    className="flex-1 min-w-0 truncate text-primary-600 dark:text-primary-400 hover:underline"
                  >
                    {r.title}
                  </a>
                  <button
                    onClick={() => void remove(r.id).then(() => onChanged?.())}
                    className="p-1.5 rounded text-gray-400 hover:text-red-500 transition-colors"
                    title="删除"
                  >
                    <FaTrash className="w-3 h-3" />
                  </button>
                </li>
              ))}
              {resources.length > 8 && (
                <li className="py-2 text-gray-400">仅显示最近 8 条（共 {resources.length} 条）</li>
              )}
            </ul>
          )}
          <p className="text-[11px] text-gray-400">
            资源库只保存在本机 IndexedDB；检索时会按关键词命中并入候选资源（标记为"我的资源库"）。
          </p>
        </div>
      )}
    </div>
  );
};
