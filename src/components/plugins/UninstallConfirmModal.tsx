// src/components/plugins/UninstallConfirmModal.tsx
// 卸载确认弹窗：明确告知数据保留策略。
// - 插件声明了 data 能力 -> 数据进入保留期（retentionDays 天），到期自动清除；
// - 未声明 -> 卸载即无数据残留。
import React from 'react';
import { FaTimes, FaTrash, FaDatabase, FaExclamationTriangle } from 'react-icons/fa';
import type { InstalledPlugin } from '../../plugins/runtime';

interface UninstallConfirmModalProps {
  plugin: InstalledPlugin | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export const UninstallConfirmModal: React.FC<UninstallConfirmModalProps> = ({
  plugin,
  onConfirm,
  onCancel,
}) => {
  if (!plugin) return null;

  const dataCap = plugin.manifest.capabilities?.data;
  const retention = dataCap?.retentionDays ?? 3;
  const hasData = !!dataCap;
  const expiresAt = hasData
    ? new Date(Date.now() + retention * 86_400_000).toLocaleDateString('zh-CN')
    : null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 text-center sm:block sm:p-0">
        <div
          className="fixed inset-0 transition-opacity bg-black bg-opacity-50"
          onClick={onCancel}
        />
        <div className="inline-block align-bottom bg-white dark:bg-gray-800 rounded-xl shadow-xl transform transition-all sm:my-24 sm:align-middle sm:max-w-md sm:w-full">
          <div className="px-6 pt-6 pb-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center">
                <FaTrash className="w-4 h-4 mr-2 text-red-500" />
                卸载插件
              </h3>
              <button
                onClick={onCancel}
                className="p-2 text-gray-400 hover:text-gray-500 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <FaTimes className="w-5 h-5" />
              </button>
            </div>

            <p className="text-gray-700 dark:text-gray-300 mb-4">
              确定要卸载
              <span className="font-semibold mx-1">「{plugin.name}」</span>
              吗？
            </p>

            {hasData ? (
              <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 mb-4">
                <div className="flex items-start">
                  <FaDatabase className="w-5 h-5 text-blue-500 mr-3 mt-0.5 flex-shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium text-blue-700 dark:text-blue-300 mb-1">
                      数据将保留 {retention} 天
                    </p>
                    <p className="text-blue-600 dark:text-blue-400 text-xs leading-relaxed">
                      插件数据不会被立即删除，保留至 {expiresAt} 后自动清除。
                      保留期内重新安装该插件可自动恢复数据；也可在插件管理页的
                      「回收站」中手动清除。
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50 mb-4 flex items-start">
                <FaExclamationTriangle className="w-5 h-5 text-gray-400 mr-3 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  该插件未声明长期数据能力，卸载后无数据残留。
                </p>
              </div>
            )}
          </div>

          <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900/50 rounded-b-xl flex justify-end space-x-3">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
            >
              取消
            </button>
            <button
              onClick={onConfirm}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center"
            >
              <FaTrash className="w-4 h-4 mr-2" />
              确认卸载
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
