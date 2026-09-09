// src/components/plugins/PluginDetailsModal.tsx
import React from 'react';
import { 
  FaTimes, 
  FaToggleOn, 
  FaToggleOff, 
  FaTrash, 
  FaUser, 
  FaCode,
  FaCalendar,
  FaShieldAlt,
  FaExclamationTriangle,
  FaCheckCircle,
  FaCogs,
  FaNetworkWired,
  FaFolderOpen,
  FaDesktop,
  FaPalette,
  FaKey
} from 'react-icons/fa';

interface PluginDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  plugin: any;
  onToggle: () => void;
  onUninstall: () => void;
}

export const PluginDetailsModal: React.FC<PluginDetailsModalProps> = ({
  isOpen,
  onClose,
  plugin,
  onToggle,
  onUninstall
}) => {
  if (!isOpen) return null;

  const manifest = plugin.manifest || {};

  // 权限图标映射
  const permissionIcons: Record<string, React.ReactNode> = {
    fs: <FaFolderOpen className="w-4 h-4 text-gray-400" />,
    network: <FaNetworkWired className="w-4 h-4 text-gray-400" />,
    system: <FaDesktop className="w-4 h-4 text-gray-400" />,
    ui: <FaPalette className="w-4 h-4 text-gray-400" />,
    api: <FaKey className="w-4 h-4 text-gray-400" />
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        <div
          className="fixed inset-0 transition-opacity bg-black bg-opacity-50"
          onClick={onClose}
        />

        <div className="inline-block align-bottom bg-white dark:bg-gray-800 rounded-xl shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-2xl sm:w-full">
          <div className="px-6 pt-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                插件详情
              </h3>
              <button
                onClick={onClose}
                className="p-2 text-gray-400 hover:text-gray-500 dark:hover:text-gray-300 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <FaTimes className="w-5 h-5" />
              </button>
            </div>

            {/* 插件基本信息 */}
            <div className="mb-8">
              <div className="flex items-start mb-6">
                <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center mr-4 flex-shrink-0">
                  <FaCogs className="w-8 h-8 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-1">
                    {plugin.name}
                  </h2>
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="text-sm font-medium px-2 py-1 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
                      v{plugin.version}
                    </span>
                    <span className={`text-sm font-medium px-2 py-1 rounded ${
                      plugin.enabled
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                        : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
                    }`}>
                      {plugin.enabled ? '已启用' : '已禁用'}
                    </span>
                  </div>
                  <p className="text-gray-600 dark:text-gray-400">
                    {plugin.description}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center">
                  <FaUser className="w-4 h-4 text-gray-400 mr-2" />
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">作者</p>
                    <p className="font-medium">{plugin.author}</p>
                  </div>
                </div>
                <div className="flex items-center">
                  <FaCode className="w-4 h-4 text-gray-400 mr-2" />
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">插件ID</p>
                    <p className="font-mono text-sm">{plugin.id}</p>
                  </div>
                </div>
                <div className="flex items-center">
                  <FaCalendar className="w-4 h-4 text-gray-400 mr-2" />
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">安装日期</p>
                    <p className="font-medium">{plugin.installedAt}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* 权限信息 */}
            {manifest.permissions && (
              <div className="mb-8">
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 flex items-center">
                  <FaShieldAlt className="w-4 h-4 mr-2" />
                  插件权限
                </h4>
                <div className="space-y-3">
                  {Object.entries(manifest.permissions).map(([key, value]: [string, any]) => (
                    <div key={key} className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                      <div className="flex items-center mb-2">
                        {permissionIcons[key]}
                        <span className="ml-2 font-medium capitalize">{key}</span>
                      </div>
                      {value && typeof value === 'object' ? (
                        <div className="ml-6 space-y-1">
                          {Object.entries(value).map(([subKey, subValue]: [string, any]) => (
                            <div key={subKey} className="flex items-center text-sm">
                              <span className="text-gray-500 dark:text-gray-400 min-w-20 capitalize">
                                {subKey}:
                              </span>
                              <span className="ml-2 font-mono text-xs">
                                {Array.isArray(subValue) ? subValue.join(', ') : String(subValue)}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="ml-6 text-sm">{String(value)}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 能力信息 */}
            {manifest.capabilities && (
              <div className="mb-8">
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 flex items-center">
                  <FaCogs className="w-4 h-4 mr-2" />
                  插件能力
                </h4>
                <div className="space-y-2">
                  {manifest.capabilities.page && (
                    <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
                      <p className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
                        新增页面：「{manifest.capabilities.page.title}」 → {manifest.capabilities.page.path}
                      </p>
                    </div>
                  )}
                  {manifest.capabilities.data && (
                    <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg">
                      <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300 mb-1">
                        读写长期数据
                      </p>
                      <p className="text-xs text-emerald-600 dark:text-emerald-400 font-mono">
                        namespace: {manifest.capabilities.data.namespace} · collections:{' '}
                        {(manifest.capabilities.data.collections ?? []).join(', ')} · ops:{' '}
                        {(manifest.capabilities.data.operations ?? ['read']).join('/')} · 卸载保留{' '}
                        {manifest.capabilities.data.retentionDays ?? 3} 天
                      </p>
                    </div>
                  )}
                  {manifest.capabilities.theme && (
                    <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                      <p className="text-sm font-medium text-purple-700 dark:text-purple-300">
                        界面主题：{manifest.capabilities.theme.mode === 'dark' ? '深色' : '浅色'}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 兼容性检查 */}
            <div className="mb-8">
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                兼容性信息
              </h4>
              <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                <div className="flex items-center">
                  <FaCheckCircle className="w-5 h-5 text-green-500 mr-2" />
                  <div>
                    <p className="font-medium text-green-700 dark:text-green-400">
                      兼容当前版本
                    </p>
                    <p className="text-sm text-green-600 dark:text-green-500">
                      最低兼容版本: {manifest.metadata?.compatibility?.minCoreVersion || '1.0.0'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* 警告信息 */}
            {manifest.permissions?.network?.domains?.includes('*') && (
              <div className="mb-8 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                <div className="flex items-start">
                  <FaExclamationTriangle className="w-5 h-5 text-yellow-500 mr-2 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-yellow-700 dark:text-yellow-400 mb-1">
                      权限警告
                    </p>
                    <p className="text-sm text-yellow-600 dark:text-yellow-500">
                      此插件请求无限制的网络访问权限。请确保您信任此插件的开发者。
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 操作按钮 */}
          <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900/50 rounded-b-xl flex justify-between">
            <button
              onClick={onUninstall}
              className="px-4 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-800/30 transition-colors flex items-center"
            >
              <FaTrash className="mr-2" />
              卸载插件
            </button>
            <div className="flex space-x-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
              >
                关闭
              </button>
              <button
                onClick={onToggle}
                className={`px-4 py-2 rounded-lg transition-colors flex items-center ${
                  plugin.enabled
                    ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-200 dark:hover:bg-yellow-800/40'
                    : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-800/40'
                }`}
              >
                {plugin.enabled ? (
                  <>
                    <FaToggleOff className="mr-2" />
                    禁用插件
                  </>
                ) : (
                  <>
                    <FaToggleOn className="mr-2" />
                    启用插件
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};