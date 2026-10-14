// src/features/plan-generator/components/MemoryCard.tsx
// 记忆管理卡片（系统设置页）。
//
// 隐私要求在这里落地：记忆**必须可审计、可删除、可整体关闭**。
// 所以这张卡片不是"炫技用的记忆列表"，而是用户的控制面板：
// 每条记忆都能看到"结论 + 证据 + 置信度 + 命中次数"，也能单条删除或一键清空。
import React from 'react';
import { FaBrain, FaTrash, FaSpinner, FaCheckCircle, FaTimesCircle, FaArchive, FaUndo } from 'react-icons/fa';
import { useMemory } from '../hooks/useMemory';
import { isArchived } from '../services/memory/memoryWriter';

const KIND_LABEL: Record<string, string> = {
  episodic: '情景记忆',
  semantic: '语义记忆',
};

export const MemoryCard: React.FC = () => {
  const memory = useMemory();

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center">
          <div className="p-2 rounded-lg bg-indigo-50 mr-3">
            <FaBrain className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">记忆（Agent Memory）</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              只保存结论与证据，不保存对话原文；生成计划时会召回相似目标的历史成败作为参考。
            </p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <input
            type="checkbox"
            checked={memory.enabled}
            onChange={(e) => void memory.setEnabled(e.target.checked)}
            className="w-4 h-4 rounded"
          />
          启用记忆
        </label>
      </div>

      {memory.loading ? (
        <div className="flex items-center justify-center py-8 text-gray-400 text-sm">
          <FaSpinner className="w-4 h-4 mr-2 animate-spin" />
          正在读取本地记忆…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4 text-sm">
            <Stat label="记忆条数" value={String(memory.stats.total)} />
            <Stat label="计划被接受" value={String(memory.stats.accepted)} tone="text-emerald-600" />
            <Stat label="计划被拒绝" value={String(memory.stats.rejected)} tone="text-amber-600" />
            <Stat label="已归档（不召回）" value={String(memory.stats.archived)} tone="text-gray-400" />
          </div>

          {!memory.enabled && (
            <p className="mb-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              记忆已关闭：新计划不再写入记忆，生成时也不会召回历史参考。已有记忆保留在本机，可继续查看或删除。
            </p>
          )}

          {memory.notes.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">
              还没有记忆。接受或拒绝一份生成计划后，这里会出现一条「结论 + 证据」记录。
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700 rounded-lg border border-gray-200 dark:border-gray-700">
              {memory.notes.map((note) => {
                const archived = isArchived(note);
                return (
                  <li key={note.id} className="px-3 py-2.5 flex items-start gap-3">
                    <span
                      className={`mt-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap ${
                        note.stats?.accepted
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-amber-50 text-amber-600'
                      }`}
                    >
                      {note.stats?.accepted ? (
                        <FaCheckCircle className="w-2.5 h-2.5 mr-1" />
                      ) : (
                        <FaTimesCircle className="w-2.5 h-2.5 mr-1" />
                      )}
                      {KIND_LABEL[note.kind] ?? note.kind}
                    </span>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                        {note.subject}
                        {archived && (
                          <span className="ml-2 inline-flex items-center text-[10px] text-gray-400">
                            <FaArchive className="w-2.5 h-2.5 mr-1" />
                            已归档
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">{note.summary}</p>
                      <p className="text-[11px] text-gray-400 mt-1">
                        置信度 {Math.round(note.confidence * 100)}% · 命中 {note.hitCount} 次 · 证据{' '}
                        {note.evidence.length} 条 · {note.lastUsedAt.slice(0, 10)}
                      </p>
                    </div>

                    <button
                      onClick={() => void memory.remove(note.id)}
                      title="删除这条记忆"
                      className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      <FaTrash className="w-3.5 h-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {memory.notes.length > 0 && (
            <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs text-gray-400">
                记忆全部存放在本机 IndexedDB，可随"数据备份"一起导出；长期未召回的记忆会降低置信度并归档。
              </p>
              <button
                onClick={() => {
                  if (window.confirm(`清空全部 ${memory.notes.length} 条记忆？该操作不可恢复。`)) {
                    void memory.clear();
                  }
                }}
                className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 text-gray-600 transition-colors whitespace-nowrap"
              >
                <FaUndo className="w-3 h-3 mr-1.5" />
                清空全部记忆
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

function Stat(props: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-gray-50 dark:bg-gray-700/40 p-3">
      <div className="text-xs text-gray-400 mb-0.5">{props.label}</div>
      <div className={`font-semibold text-sm ${props.tone ?? 'text-gray-900 dark:text-gray-100'}`}>{props.value}</div>
    </div>
  );
}
