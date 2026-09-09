// src/pages/PluginManager.tsx
// 插件管理页：数据来自插件注册表（持久化），而非 mock。
// 性能设计（大量插件场景）：
// - 搜索输入经 useDeferredValue 降级 + useMemo 过滤：键入不卡顿
// - 行组件 React.memo + 稳定对象引用：单个插件变更不重渲染其他行
// - 条目超过阈值时启用窗口化渲染（useWindowedList），只渲染可见行
// - 激活指标实时展示，直观看到宿主批量激活耗时
import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  FaPlug,
  FaPlus,
  FaToggleOn,
  FaToggleOff,
  FaCheckCircle,
  FaExclamationCircle,
  FaSpinner,
  FaCode,
  FaBoxOpen,
  FaStore,
  FaMoon,
  FaSmile,
  FaBorderAll,
  FaBolt,
} from 'react-icons/fa';
import { parsePluginFile, parsePluginFromURL, type PluginManifest } from '../plugins/parser';
import { usePluginHost, type InstalledPlugin } from '../plugins/runtime';
import { BUILTIN_PLUGINS, compareVersions, getBuiltinVersion } from '../plugins/builtin';
import { PluginInstallModal } from '../components/plugins/PluginInstallModal';
import { PluginDetailsModal } from '../components/plugins/PluginDetailsModal';
import { PluginListItem } from '../components/plugins/PluginListItem';
import { UninstallConfirmModal } from '../components/plugins/UninstallConfirmModal';
import { TrashPanel } from '../components/plugins/TrashPanel';
import { useWindowedList } from '../hooks/useWindowedList';

const BUILTIN_ICON: Record<string, React.ReactNode> = {
  'dark-theme': <FaMoon className="w-5 h-5 text-indigo-400" />,
  'mood-diary': <FaSmile className="w-5 h-5 text-amber-400" />,
  'wireframe': <FaBorderAll className="w-5 h-5 text-gray-700 dark:text-gray-300" />,
};

const BUILTIN_DESC: Record<string, string> = {
  'dark-theme': '深色外观由插件系统托管，安装后可在设置页切换',
  'mood-diary': '心情日历 / 打分 / 回顾，数据按命名空间写入本地数据库',
  'wireframe': '墨黑 × 酸性荧光绿的沙箱代码主题：由插件 JS 动态生成设计令牌与整站样式',
};

export const PluginManager: React.FC = () => {
  const {
    ready,
    plugins,
    metrics,
    coreVersion,
    tombstones,
    installFromManifest,
    installFromToml,
    uninstall,
    purgePluginData,
    setEnabled,
    getPlugin,
  } = usePluginHost();

  const [installModalOpen, setInstallModalOpen] = useState(false);
  const [selectedPlugin, setSelectedPlugin] = useState<InstalledPlugin | null>(null);
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [uninstallTarget, setUninstallTarget] = useState<InstalledPlugin | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [parsingPlugin, setParsingPlugin] = useState<Awaited<ReturnType<typeof parsePluginFile>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [installingBuiltin, setInstallingBuiltin] = useState<string | null>(null);
  const [trashBusyId, setTrashBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // ---- 过滤与统计（memo 化，避免每次渲染重算；搜索经 deferred 降级） ----
  const deferredQuery = useDeferredValue(searchQuery);

  const filteredPlugins = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return plugins.filter((plugin) => {
      const matchesSearch =
        !q ||
        plugin.name.toLowerCase().includes(q) ||
        plugin.description.toLowerCase().includes(q) ||
        plugin.author.toLowerCase().includes(q);
      if (filter === 'enabled') return matchesSearch && plugin.enabled;
      if (filter === 'disabled') return matchesSearch && !plugin.enabled;
      return matchesSearch;
    });
  }, [plugins, deferredQuery, filter]);

  const stats = useMemo(
    () => ({
      total: plugins.length,
      enabled: plugins.filter((p) => p.enabled).length,
      disabled: plugins.filter((p) => !p.enabled).length,
    }),
    [plugins],
  );

  // ---- 窗口化渲染：大量插件时只渲染可见行 ----
  const { containerRef, windowed, slice, padTop, padBottom, itemHeight } = useWindowedList(
    filteredPlugins,
    { itemHeight: 232, threshold: 60 },
  );

  // ---- 操作（回调引用稳定，配合行组件 memo） ----

  const viewPluginDetails = useCallback((plugin: InstalledPlugin) => {
    setSelectedPlugin(plugin);
    setDetailsModalOpen(true);
  }, []);

  const handleTogglePlugin = useCallback(
    (id: string) => {
      const plugin = getPlugin(id);
      if (!plugin) return;
      const next = !plugin.enabled;
      void setEnabled(id, next).then(() => {
        setSuccess(`插件 "${plugin.name}" 已${next ? '启用' : '禁用'}`);
      });
    },
    [getPlugin, setEnabled],
  );

  // 卸载：弹出保留期说明确认框（不再使用 window.confirm）
  const handleUninstallPlugin = useCallback((id: string) => {
    const plugin = getPlugin(id);
    if (!plugin) return;
    setUninstallTarget(plugin);
  }, [getPlugin]);

  const confirmUninstall = useCallback(() => {
    if (!uninstallTarget) return;
    const name = uninstallTarget.name;
    void uninstall(uninstallTarget.id).then(() => {
      setSuccess(
        `插件 "${name}" 已卸载${
          uninstallTarget.manifest.capabilities?.data
            ? '，数据进入保留期（可在回收站查看）'
            : ''
        }`,
      );
    });
    setUninstallTarget(null);
  }, [uninstallTarget, uninstall]);

  const handleInstallPlugin = useCallback(
    async (manifest: PluginManifest) => {
      const res = await installFromManifest(manifest);
      if (res.ok) {
        setSuccess(`插件 "${res.plugin?.name}" 已成功安装${res.plugin?.enabled ? '并启用' : ''}`);
        setInstallModalOpen(false);
        setParsingPlugin(null);
      } else {
        setError(`安装失败：${res.errors.join('、')}`);
      }
    },
    [installFromManifest],
  );

  // 文件上传：解析（安装由弹窗确认后触发）
  const handlePluginFileUpload = useCallback(async (file: File) => {
    try {
      setLoading(true);
      setError(null);
      const result = await parsePluginFile(file);
      setParsingPlugin(result);
      if (!result.success) {
        setError('插件文件格式无效：' + result.errors.map((e) => e.message).join('、'));
      }
    } catch (err: any) {
      setError(`解析失败：${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // URL 安装：拉取并解析远程清单
  const handleUrlFetch = useCallback(async (url: string) => {
    try {
      setLoading(true);
      setError(null);
      const result = await parsePluginFromURL(url);
      setParsingPlugin(result);
      if (!result.success) {
        setError('插件文件格式无效：' + result.errors.map((e) => e.message).join('、'));
      }
    } catch (err: any) {
      setError(`获取插件失败：${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // 内置插件一键安装（真实 TOML 清单 -> 解析 -> 注册 -> 宿主激活）
  const installBuiltin = useCallback(
    async (builtinId: string) => {
      const builtin = BUILTIN_PLUGINS[builtinId];
      if (!builtin) return;
      setInstallingBuiltin(builtinId);
      setError(null);
      const res = await installFromToml(builtin.toml, 'builtin');
      setInstallingBuiltin(null);
      if (res.ok) {
        setSuccess(`内置插件 "${res.plugin?.name}" 已安装并启用`);
      } else {
        setError(`安装失败：${res.errors.join('、')}`);
      }
    },
    [installFromToml],
  );

  // 回收站：重新安装内置插件（保留期内自动恢复数据）
  const handleReinstallFromTrash = useCallback(
    async (pluginId: string) => {
      const builtin = BUILTIN_PLUGINS[pluginId];
      if (!builtin) {
        setError('该插件不是内置插件，请通过"安装插件"重新安装以恢复数据');
        return;
      }
      setTrashBusyId(pluginId);
      setError(null);
      const res = await installFromToml(builtin.toml, 'builtin');
      setTrashBusyId(null);
      if (res.ok) {
        setSuccess(`已重新安装「${res.plugin?.name}」并恢复其保留数据`);
      } else {
        setError(`重新安装失败：${res.errors.join('、')}`);
      }
    },
    [installFromToml],
  );

  // 回收站：立即清除保留数据
  const handlePurgeFromTrash = useCallback(
    async (pluginId: string) => {
      if (!window.confirm('立即清除该插件的全部保留数据？此操作不可恢复。')) return;
      setTrashBusyId(pluginId);
      await purgePluginData(pluginId);
      setTrashBusyId(null);
      setSuccess('已清除保留数据');
    },
    [purgePluginData],
  );

  const missingBuiltins = useMemo(
    () => Object.values(BUILTIN_PLUGINS).filter((b) => !getPlugin(b.id)),
    [plugins, getPlugin],
  );

  // 已安装但落后于内置版本的内置插件（如 wireframe 1.0.0 -> 1.1.0）
  const staleBuiltins = useMemo(
    () =>
      Object.values(BUILTIN_PLUGINS)
        .map((b) => ({ b, installed: getPlugin(b.id), next: getBuiltinVersion(b.id) }))
        .filter(
          (x): x is { b: (typeof BUILTIN_PLUGINS)[string]; installed: InstalledPlugin; next: string } =>
            !!x.installed && !!x.next && compareVersions(x.installed.version, x.next) < 0,
        ),
    [plugins, getPlugin],
  );

  // 清除消息
  useEffect(() => {
    if (success || error) {
      const timer = setTimeout(() => {
        setSuccess(null);
        setError(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [success, error]);

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center">
            <FaPlug className="mr-3 text-primary-500" />
            插件管理
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            扩展应用功能，安装和管理第三方插件
          </p>
        </div>

        <button
          onClick={() => setInstallModalOpen(true)}
          className="btn btn-primary flex items-center px-4 py-2"
        >
          <FaPlus className="mr-2" />
          安装插件
        </button>
      </div>

      {/* 内置插件推荐（未安装的内置插件） */}
      {missingBuiltins.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300">
            内置插件
          </div>
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {missingBuiltins.map((builtin) => (
              <div key={builtin.id} className="px-5 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center">
                  <div className="w-11 h-11 rounded-lg bg-gray-100 dark:bg-gray-700/60 flex items-center justify-center mr-4 flex-shrink-0">
                    {BUILTIN_ICON[builtin.id]}
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center">
                      {builtin.name}
                      <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 font-mono">
                        {builtin.id}.toml
                      </span>
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                      {BUILTIN_DESC[builtin.id]}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => installBuiltin(builtin.id)}
                  disabled={installingBuiltin != null}
                  className="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg font-medium transition-colors flex items-center disabled:opacity-60 whitespace-nowrap"
                >
                  {installingBuiltin === builtin.id ? (
                    <>
                      <FaSpinner className="mr-2 animate-spin" />
                      安装中...
                    </>
                  ) : (
                    <>
                      <FaPlus className="mr-2" />
                      一键安装
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 内置插件可更新（已安装版本落后于内置清单） */}
      {staleBuiltins.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300">
            内置插件更新
          </div>
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {staleBuiltins.map(({ b, installed, next }) => (
              <div key={b.id} className="px-5 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center">
                  <div className="w-11 h-11 rounded-lg bg-gray-100 dark:bg-gray-700/60 flex items-center justify-center mr-4 flex-shrink-0">
                    {BUILTIN_ICON[b.id]}
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center">
                      {b.name}
                      <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400">
                        v{installed.version} → v{next}
                      </span>
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                      {BUILTIN_DESC[b.id]}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => installBuiltin(b.id)}
                  disabled={installingBuiltin != null}
                  className="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg font-medium transition-colors flex items-center disabled:opacity-60 whitespace-nowrap"
                >
                  {installingBuiltin === b.id ? (
                    <>
                      <FaSpinner className="mr-2 animate-spin" />
                      更新中...
                    </>
                  ) : (
                    <>
                      <FaPlus className="mr-2" />
                      更新到 v{next}
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 回收站：卸载后保留期内的数据 */}
      <TrashPanel
        tombstones={tombstones}
        busyId={trashBusyId}
        builtinIds={new Set(Object.keys(BUILTIN_PLUGINS))}
        onReinstall={handleReinstallFromTrash}
        onPurge={handlePurgeFromTrash}
      />

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6">
          <div className="flex items-center">
            <div className="w-12 h-12 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mr-4">
              <FaBoxOpen className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">总插件数</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats.total}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6">
          <div className="flex items-center">
            <div className="w-12 h-12 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center mr-4">
              <FaToggleOn className="w-6 h-6 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">已启用</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats.enabled}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6">
          <div className="flex items-center">
            <div className="w-12 h-12 rounded-lg bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center mr-4">
              <FaToggleOff className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">已禁用</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats.disabled}</p>
            </div>
          </div>
        </div>
      </div>

      {/* 消息通知 */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex items-center">
            <FaExclamationCircle className="w-5 h-5 text-red-500 mr-3 flex-shrink-0" />
            <p className="text-red-700 dark:text-red-400">{error}</p>
          </div>
        </div>
      )}

      {success && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
          <div className="flex items-center">
            <FaCheckCircle className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" />
            <p className="text-green-700 dark:text-green-400">{success}</p>
          </div>
        </div>
      )}

      {/* 搜索和筛选栏 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <input
                type="text"
                placeholder="搜索插件名称、描述或作者..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
              <FaCode className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            </div>
          </div>

          <div className="flex space-x-2">
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2 rounded-lg transition-colors ${
                filter === 'all'
                  ? 'bg-primary-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              全部 ({stats.total})
            </button>
            <button
              onClick={() => setFilter('enabled')}
              className={`px-4 py-2 rounded-lg transition-colors ${
                filter === 'enabled'
                  ? 'bg-green-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              已启用 ({stats.enabled})
            </button>
            <button
              onClick={() => setFilter('disabled')}
              className={`px-4 py-2 rounded-lg transition-colors ${
                filter === 'disabled'
                  ? 'bg-yellow-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              已禁用 ({stats.disabled})
            </button>
          </div>
        </div>
      </div>

      {/* 插件列表 */}
      <div
        ref={containerRef}
        className={`bg-white dark:bg-gray-800 rounded-xl shadow-sm ${
          windowed ? 'max-h-[70vh] overflow-y-auto' : 'overflow-hidden'
        }`}
      >
        {!ready ? (
          <div className="flex flex-col items-center justify-center p-12">
            <FaSpinner className="w-8 h-8 text-primary-500 animate-spin mb-4" />
            <p className="text-gray-600 dark:text-gray-400">加载插件中...</p>
          </div>
        ) : loading ? (
          <div className="flex flex-col items-center justify-center p-12">
            <FaSpinner className="w-8 h-8 text-primary-500 animate-spin mb-4" />
            <p className="text-gray-600 dark:text-gray-400">解析插件清单中...</p>
          </div>
        ) : filteredPlugins.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <FaBoxOpen className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
              暂无插件
            </h3>
            <p className="text-gray-500 dark:text-gray-400 mb-6">
              {searchQuery ? '没有找到匹配的插件' : '您还没有安装任何插件'}
            </p>
            <button
              onClick={() => setInstallModalOpen(true)}
              className="bg-primary-500 hover:bg-primary-600 text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center"
            >
              <FaPlus className="mr-2" />
              安装第一个插件
            </button>
          </div>
        ) : (
          <>
            {/* 运行指标条 */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-xs text-gray-500 dark:text-gray-400">
              <span className="flex items-center">
                <FaBolt className="w-3 h-3 mr-1 text-primary-500" />
                核心 v{coreVersion}
              </span>
              <span>启用 {stats.enabled}/{stats.total}</span>
              <span>激活 {metrics.activated} 个插件</span>
              {metrics.lastActivationMs > 0 && (
                <span>最近批量激活耗时 {metrics.lastActivationMs}ms</span>
              )}
              {windowed && <span className="text-primary-500 font-medium">窗口化渲染已启用</span>}
            </div>

            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              <div style={{ paddingTop: padTop, paddingBottom: padBottom }}>
                {slice.map((plugin) => (
                  <PluginListItem
                    key={plugin.id}
                    plugin={plugin}
                    onDetails={viewPluginDetails}
                    onToggle={handleTogglePlugin}
                    onUninstall={handleUninstallPlugin}
                    windowed={windowed}
                    itemHeight={itemHeight}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* 插件市场提示 */}
      <div className="bg-gradient-to-r from-primary-500 to-primary-700 rounded-xl shadow-sm p-6 text-white">
        <div className="flex flex-col md:flex-row items-center justify-between">
          <div className="mb-4 md:mb-0">
            <h3 className="text-xl font-bold mb-2">发现更多插件</h3>
            <p className="opacity-90">
              访问插件市场，发现更多增强应用功能的扩展
            </p>
          </div>
          <button
            className="px-6 py-3 bg-white text-primary-700 rounded-lg font-semibold hover:bg-gray-100 transition-colors flex items-center"
            onClick={() => {
              setError('插件市场功能开发中...');
            }}
          >
            <FaStore className="mr-2" />
            前往插件市场
          </button>
        </div>
      </div>

      {/* 安装插件模态框 */}
      <PluginInstallModal
        isOpen={installModalOpen}
        onClose={() => setInstallModalOpen(false)}
        onInstall={handleInstallPlugin}
        onFileUpload={handlePluginFileUpload}
        onFetchUrl={handleUrlFetch}
        parsingResult={parsingPlugin}
        loading={loading}
      />

      {/* 插件详情模态框 */}
      {selectedPlugin && (
        <PluginDetailsModal
          isOpen={detailsModalOpen}
          onClose={() => setDetailsModalOpen(false)}
          plugin={selectedPlugin}
          onToggle={() => handleTogglePlugin(selectedPlugin.id)}
          onUninstall={() => {
            handleUninstallPlugin(selectedPlugin.id);
            setDetailsModalOpen(false);
          }}
        />
      )}

      {/* 卸载确认（含数据保留期说明） */}
      <UninstallConfirmModal
        plugin={uninstallTarget}
        onConfirm={confirmUninstall}
        onCancel={() => setUninstallTarget(null)}
      />
    </div>
  );
};
