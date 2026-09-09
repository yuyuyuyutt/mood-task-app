// src/components/plugins/TrashPanel.tsx
// 回收站：展示卸载后仍在保留期内的插件数据，支持"重新安装（内置）"与"立即清除"。
import React from 'react';
import {
  FaRecycle, FaTrash, FaUndo, FaSpinner,
} from 'react-icons/fa';
import type { Tombstone } from '../../plugins/runtime';

interface TrashPanelProps {
  tombstones: Tombstone[];
  busyId: string | null;
  /** 可一键重新安装的内置插件 id 集合 */
  builtinIds: Set<string>;
  onReinstall: (pluginId: string) => void;
  onPurge: (pluginId: string) => void;
}

function remainingLabel(t: Tombstone): string {
  const ms = t.uninstalledAt + t.retentionDays * 86_400_000 - Date.now();
  const days = Math.ceil(ms / 86_400_000);
  const date = new Date(t.uninstalledAt + t.retentionDays * 86_400_000).toLocaleDateString('zh-CN');
  return days > 0 ? `剩余 ${days} 天（${date} 自动清除）` : `已到期（${date}）`;
}

export const TrashPanel: React.FC<TrashPanelProps> = ({
  tombstones,
  busyId,
  builtinIds,
  onReinstall,
  onPurge,
}) => {
  if (tombstones.length === 0) return null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="px-5 py-3 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700 flex items-center">
        <FaRecycle className="w-4 h-4 text-primary-500 mr-2" />
        <h3 className="font-medium text-gray-700 dark:text-gray-300">回收站</h3>
        <span className="ml-2 text-xs text-gray-400">
          {tombstones.length} 个插件的数据在保留期内（禁用不会清除数据，卸载后保留 3 天）
        </span>
      </div>
      <div className="divide-y divide-gray-200 dark:divide-gray-700">
        {tombstones.map((t) => (
          <div key={t.pluginId} className="px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                {t.pluginName}
                {t.namespace && (
                  <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-mono">
                    {t.namespace}
                  </span>
                )}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{remainingLabel(t)}</p>
            </div>
            <div className="flex space-x-2 flex-shrink-0">
              <button
                onClick={() => onReinstall(t.pluginId)}
                disabled={busyId != null || !builtinIds.has(t.pluginId)}
                className="px-3 py-1.5 text-xs bg-primary-50 dark:bg-blue-900/30 text-primary-600 dark:text-blue-400 rounded-lg hover:bg-primary-100 dark:hover:bg-blue-900/50 transition-colors flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
                title={
                  builtinIds.has(t.pluginId)
                    ? '重新安装内置插件并恢复数据'
                    : '非内置插件：请通过"安装插件"重新安装以恢复数据'
                }
              >
                {busyId === t.pluginId ? (
                  <FaSpinner className="w-3 h-3 mr-1 animate-spin" />
                ) : (
                  <FaUndo className="w-3 h-3 mr-1" />
                )}
                重新安装
              </button>
              <button
                onClick={() => onPurge(t.pluginId)}
                disabled={busyId != null}
                className="px-3 py-1.5 text-xs bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-800/30 transition-colors flex items-center disabled:opacity-50"
                title="立即清除该插件的保留数据（不可恢复）"
              >
                {busyId === t.pluginId ? (
                  <FaSpinner className="w-3 h-3 mr-1 animate-spin" />
                ) : (
                  <FaTrash className="w-3 h-3 mr-1" />
                )}
                立即清除
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
