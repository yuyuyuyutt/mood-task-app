// src/components/plugins/PluginListItem.tsx
// 单个插件行。React.memo + 稳定的对象引用（registry 保证未变更插件的引用稳定），
// 使列表中某个插件的开关/卸载等操作不会触发其他行重渲染。
import React from 'react';
import {
  FaUser,
  FaCalendar,
  FaCode,
  FaShieldAlt,
  FaCheckCircle,
  FaExclamationTriangle,
  FaInfoCircle,
  FaToggleOn,
  FaToggleOff,
  FaTrash,
  FaFolderOpen,
  FaNetworkWired,
  FaDesktop,
  FaPalette,
  FaFile,
  FaDatabase,
} from 'react-icons/fa';
import { CORE_VERSION, type InstalledPlugin } from '../../plugins/runtime';

interface PluginListItemProps {
  plugin: InstalledPlugin;
  onDetails: (plugin: InstalledPlugin) => void;
  onToggle: (id: string) => void;
  onUninstall: (id: string) => void;
  /** 窗口化模式：行使用固定高度（与 useWindowedList 的 itemHeight 一致） */
  windowed?: boolean;
  itemHeight?: number;
}

/** 版本比较：v1 > v2 → 1，相等 → 0，v1 < v2 → -1 */
function compareVersions(v1: string, v2: string): number {
  const parse = (v: string): number[] =>
    v
      .split('-')[0]
      .split('+')[0]
      .split('.')
      .map(Number);
  const a = parse(v1);
  const b = parse(v2);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function checkCompatibility(plugin: InstalledPlugin): { compatible: boolean; message: string } {
  const minVersion = plugin.manifest.metadata.compatibility?.minCoreVersion ?? '1.0.0';
  const maxVersion = plugin.manifest.metadata.compatibility?.maxCoreVersion;
  try {
    if (compareVersions(minVersion, CORE_VERSION) > 0) {
      return { compatible: false, message: `需要系统版本 >= ${minVersion}` };
    }
    if (maxVersion && compareVersions(maxVersion, CORE_VERSION) < 0) {
      return { compatible: false, message: `仅支持系统版本 <= ${maxVersion}` };
    }
    return { compatible: true, message: '兼容当前版本' };
  } catch {
    return { compatible: false, message: '版本格式错误' };
  }
}

export const PluginListItem: React.FC<PluginListItemProps> = React.memo(
  ({ plugin, onDetails, onToggle, onUninstall, windowed = false, itemHeight = 0 }) => {
    const compatibility = checkCompatibility(plugin);
    const permissions = plugin.manifest.permissions ?? {};
    const hasPermissions = Object.values(permissions).some((v) => v !== undefined);

    return (
      <div
        className={`p-6 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors ${
          windowed ? 'overflow-hidden' : ''
        }`}
        style={windowed && itemHeight > 0 ? { height: itemHeight } : undefined}
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center mb-2">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate mr-3">
                {plugin.name}
              </h3>
              <span className="text-sm font-medium px-2 py-1 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
                v{plugin.version}
              </span>
              <span
                className={`text-sm font-medium px-2 py-1 rounded ml-2 ${
                  plugin.enabled
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                    : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
                }`}
              >
                {plugin.enabled ? '已启用' : '已禁用'}
              </span>
            </div>

            <p className="text-gray-600 dark:text-gray-400 mb-3 line-clamp-2">{plugin.description}</p>

            <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
              <span className="flex items-center">
                <FaCode className="w-3 h-3 mr-1" />
                ID: {plugin.id}
              </span>
              <span className="flex items-center">
                <FaUser className="w-3 h-3 mr-1" />
                作者: {plugin.author}
              </span>
              <span className="flex items-center">
                <FaCalendar className="w-3 h-3 mr-1" />
                安装于: {plugin.installedAt}
              </span>
              {hasPermissions && (
                <span className="flex items-center">
                  <FaShieldAlt className="w-3 h-3 mr-1" />
                  {Object.keys(permissions).filter((k) => permissions[k as keyof typeof permissions] !== undefined).length} 项权限
                </span>
              )}
              {compatibility.compatible ? (
                <span className="flex items-center text-green-600 dark:text-green-400">
                  <FaCheckCircle className="w-3 h-3 mr-1" />
                  {compatibility.message}
                </span>
              ) : (
                <span className="flex items-center text-red-600 dark:text-red-400">
                  <FaExclamationTriangle className="w-3 h-3 mr-1" />
                  {compatibility.message}
                </span>
              )}
            </div>

            {/* 能力标签：页面 / 数据 */}
            {(plugin.manifest.capabilities?.page || plugin.manifest.capabilities?.data) && (
              <div className="flex flex-wrap gap-2 mt-3">
                {plugin.manifest.capabilities?.page && (
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300">
                    <FaFile className="w-3 h-3 mr-1" />
                    页面: {plugin.manifest.capabilities.page.title} ({plugin.manifest.capabilities.page.path})
                  </span>
                )}
                {plugin.manifest.capabilities?.data && (
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300">
                    <FaDatabase className="w-3 h-3 mr-1" />
                    数据: {plugin.manifest.capabilities.data.namespace} ·{' '}
                    {(plugin.manifest.capabilities.data.operations ?? ['read']).join('/')} · 保留{' '}
                    {plugin.manifest.capabilities.data.retentionDays ?? 3} 天
                  </span>
                )}
              </div>
            )}

            {hasPermissions && (
              <div className="flex flex-wrap gap-2 mt-3">
                {permissions.fs && (
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300">
                    <FaFolderOpen className="w-3 h-3 mr-1" />
                    文件系统
                  </span>
                )}
                {permissions.network && (
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300">
                    <FaNetworkWired className="w-3 h-3 mr-1" />
                    网络访问
                  </span>
                )}
                {permissions.system && (
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300">
                    <FaDesktop className="w-3 h-3 mr-1" />
                    系统功能
                  </span>
                )}
                {permissions.ui && (
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300">
                    <FaPalette className="w-3 h-3 mr-1" />
                    界面控制
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={() => onDetails(plugin)}
              className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors flex items-center justify-center"
            >
              <FaInfoCircle className="mr-2" />
              详情
            </button>
            <button
              onClick={() => onToggle(plugin.id)}
              className={`px-4 py-2 rounded-lg transition-colors flex items-center justify-center ${
                plugin.enabled
                  ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-200 dark:hover:bg-yellow-800/40'
                  : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-800/40'
              }`}
            >
              {plugin.enabled ? (
                <>
                  <FaToggleOff className="mr-2" />
                  禁用
                </>
              ) : (
                <>
                  <FaToggleOn className="mr-2" />
                  启用
                </>
              )}
            </button>
            <button
              onClick={() => onUninstall(plugin.id)}
              className="px-4 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-800/30 transition-colors flex items-center justify-center"
            >
              <FaTrash className="mr-2" />
              卸载
            </button>
          </div>
        </div>
      </div>
    );
  },
);

PluginListItem.displayName = 'PluginListItem';
