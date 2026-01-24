// src/pages/PluginManager.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { 
  FaPlug, 
  FaPlus, 
  FaTrash, 
  FaToggleOn, 
  FaToggleOff, 
  FaInfoCircle,
  FaCheckCircle,
  FaExclamationTriangle,
  FaSpinner,
  FaCode,
  FaShieldAlt,
  FaBoxOpen,
  FaExclamationCircle,
  FaStore,
  FaUser,
  FaCalendar,
  FaNetworkWired,
  FaFolderOpen,
  FaDesktop,
  FaPalette
} from 'react-icons/fa';
import { PluginParser, parsePluginFile, type PluginManifest, type ParseResult } from '../plugins/parser';
import { PluginInstallModal } from '../components/plugins/PluginInstallModal';
import { PluginDetailsModal } from '../components/plugins/PluginDetailsModal';

// 统一的插件类型接口
interface PluginItem {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  enabled: boolean;
  installedAt: string;
  manifest: PluginManifest;
}

// 辅助函数：创建完整的插件对象
const createPluginItem = (manifest: PluginManifest, enabled: boolean = true): PluginItem => {
  const now = new Date();
  const formattedDate = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
  
  return {
    id: manifest.metadata.id || manifest.metadata.name.toLowerCase().replace(/\s+/g, '-'),
    name: manifest.metadata.name,
    version: manifest.metadata.version,
    author: manifest.metadata.author,
    description: manifest.metadata.description,
    enabled,
    installedAt: formattedDate,
    manifest
  };
};

// 修正后的 mock 数据，确保类型一致
const mockPlugins: PluginItem[] = [
  createPluginItem({
    metadata: {
      id: 'weather-widget',
      name: '天气小部件',
      version: '1.2.0',
      author: '气象局',
      description: '实时显示天气信息的小部件',
      compatibility: {
        minCoreVersion: '1.0.0',
        maxCoreVersion: '2.0.0',
        testedVersions: ['1.0.0', '1.5.0']
      },
      createdAt: '2024-01-15T00:00:00Z',
      signature: undefined,
      updatedAt: undefined,
      homepage: 'https://example.com',
      license: 'MIT'
    },
    permissions: {
      network: {
        domains: ['api.weather.com'],
        protocols: ['https']
      },
      fs: undefined,
      system: undefined,
      ui: undefined,
      api: undefined
    },
    frontend: {
      entry: './index.jsx',
      type: 'widget'
    },
    dependencies: undefined,
    backend: undefined,
    assets: undefined,
    hooks: undefined
  }, true),
  
  createPluginItem({
    metadata: {
      id: 'calendar-integration',
      name: '日历集成',
      version: '1.0.3',
      author: '日程管理团队',
      description: '将任务与系统日历同步',
      compatibility: {
        minCoreVersion: '1.0.0',
        maxCoreVersion: undefined,
        testedVersions: []
      },
      createdAt: '2024-01-10T00:00:00Z',
      signature: undefined,
      updatedAt: undefined,
      homepage: undefined,
      license: 'GPL-3.0'
    },
    permissions: {
      fs: {
        read: ['/data/calendar'],
        write: ['/data/calendar']
      },
      network: undefined,
      system: undefined,
      ui: undefined,
      api: undefined
    },
    frontend: {
      entry: './calendar.jsx',
      type: 'widget'
    },
    dependencies: undefined,
    backend: undefined,
    assets: undefined,
    hooks: undefined
  }, false),
  
  createPluginItem({
    metadata: {
      id: 'dark-theme-enhancer',
      name: '深色主题增强',
      version: '2.1.0',
      author: '主题设计师',
      description: '提供更丰富的深色主题选项',
      compatibility: {
        minCoreVersion: '1.0.0',
        maxCoreVersion: '3.0.0',
        testedVersions: ['2.0.0', '2.1.0']
      },
      createdAt: '2024-01-05T00:00:00Z',
      signature: undefined,
      updatedAt: undefined,
      homepage: 'https://theme.example.com',
      license: 'Apache-2.0'
    },
    permissions: {
      ui: {
        overlay: true,
        notification: false,
        contextMenu: false,
        keyboardShortcuts: undefined
      },
      fs: undefined,
      network: undefined,
      system: undefined,
      api: undefined
    },
    frontend: {
      entry: './theme.jsx',
      type: 'widget'
    },
    dependencies: undefined,
    backend: undefined,
    assets: undefined,
    hooks: undefined
  }, true)
];

export const PluginManager: React.FC = () => {
  const [plugins, setPlugins] = useState<PluginItem[]>(mockPlugins);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [installModalOpen, setInstallModalOpen] = useState(false);
  const [selectedPlugin, setSelectedPlugin] = useState<PluginItem | null>(null);
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [parsingPlugin, setParsingPlugin] = useState<ParseResult | null>(null);

  // 过滤插件
  const filteredPlugins = plugins.filter(plugin => {
    const matchesSearch = 
      plugin.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      plugin.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      plugin.author.toLowerCase().includes(searchQuery.toLowerCase());
    
    if (filter === 'all') return matchesSearch;
    if (filter === 'enabled') return matchesSearch && plugin.enabled;
    if (filter === 'disabled') return matchesSearch && !plugin.enabled;
    
    return matchesSearch;
  });

  // 切换插件启用状态
  const togglePlugin = useCallback((pluginId: string) => {
    setPlugins(prev => prev.map(plugin => 
      plugin.id === pluginId 
        ? { ...plugin, enabled: !plugin.enabled }
        : plugin
    ));
    const plugin = plugins.find(p => p.id === pluginId);
    setSuccess(`插件 "${plugin?.name}" 已${plugin?.enabled ? '禁用' : '启用'}`);
  }, [plugins]);

  // 卸载插件
  const uninstallPlugin = useCallback((pluginId: string) => {
    if (window.confirm('确定要卸载此插件吗？此操作不可撤销。')) {
      setPlugins(prev => prev.filter(plugin => plugin.id !== pluginId));
      setSuccess('插件已卸载');
    }
  }, []);

  // 查看插件详情
  const viewPluginDetails = useCallback((plugin: PluginItem) => {
    setSelectedPlugin(plugin);
    setDetailsModalOpen(true);
  }, []);

  // 安装新插件
  const handleInstallPlugin = useCallback((manifest: PluginManifest) => {
    const newPlugin = createPluginItem(manifest, true);
    
    setPlugins(prev => {
      // 检查是否已存在同名插件
      const existingIndex = prev.findIndex(p => p.id === newPlugin.id);
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = newPlugin;
        return updated;
      }
      return [...prev, newPlugin];
    });

    setSuccess(`插件 "${manifest.metadata.name}" 已成功安装`);
    setInstallModalOpen(false);
  }, []);

  // 解析插件文件
  const handlePluginFileUpload = useCallback(async (file: File) => {
    try {
      setLoading(true);
      setError(null);
      
      const result = await parsePluginFile(file);
      setParsingPlugin(result);
      
      if (result.success && result.manifest) {
        // 创建预览对象
        const previewPlugin = createPluginItem(result.manifest, true);
        setSelectedPlugin(previewPlugin);
      } else {
        setError('插件文件格式无效：' + result.errors.map(e => e.message).join(', '));
      }
    } catch (err: any) {
      setError(`解析失败：${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // 检查插件兼容性
  const checkCompatibility = (plugin: PluginItem): { compatible: boolean; message: string } => {
    const minVersion = plugin.manifest.metadata.compatibility?.minCoreVersion || '1.0.0';
    const currentVersion = '1.0.0'; // 假设当前版本
    
    const parseVersion = (version: string): number[] => {
      // 移除预发布版本和构建元数据
      const cleanVersion = version.split('-')[0].split('+')[0];
      return cleanVersion.split('.').map(Number);
    };
    
    try {
      const v1Parts = parseVersion(minVersion);
      const v2Parts = parseVersion(currentVersion);
      
      for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
        const part1 = v1Parts[i] || 0;
        const part2 = v2Parts[i] || 0;
        
        if (part1 > part2) {
          return { 
            compatible: false, 
            message: `需要系统版本 >= ${minVersion}` 
          };
        }
        if (part1 < part2) {
          return { 
            compatible: true, 
            message: '兼容当前版本' 
          };
        }
      }
      
      return { compatible: true, message: '兼容当前版本' };
    } catch (error) {
      return { compatible: false, message: '版本格式错误' };
    }
  };

  // 统计信息
  const stats = {
    total: plugins.length,
    enabled: plugins.filter(p => p.enabled).length,
    disabled: plugins.filter(p => !p.enabled).length
  };

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

  // 权限图标映射
  const permissionIcons: Record<string, React.ReactNode> = {
    fs: <FaFolderOpen className="w-4 h-4 text-gray-400" />,
    network: <FaNetworkWired className="w-4 h-4 text-gray-400" />,
    system: <FaDesktop className="w-4 h-4 text-gray-400" />,
    ui: <FaPalette className="w-4 h-4 text-gray-400" />
  };

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
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center p-12">
            <FaSpinner className="w-8 h-8 text-primary-500 animate-spin mb-4" />
            <p className="text-gray-600 dark:text-gray-400">加载插件中...</p>
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
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {filteredPlugins.map((plugin) => {
              const compatibility = checkCompatibility(plugin);
              const hasPermissions = plugin.manifest.permissions && 
                Object.values(plugin.manifest.permissions).some(v => v !== undefined);
              
              return (
                <div key={plugin.id} className="p-6 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center mb-2">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate mr-3">
                          {plugin.name}
                        </h3>
                        <span className="text-sm font-medium px-2 py-1 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
                          v{plugin.version}
                        </span>
                        {plugin.enabled ? (
                          <span className="text-sm font-medium px-2 py-1 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 ml-2">
                            已启用
                          </span>
                        ) : (
                          <span className="text-sm font-medium px-2 py-1 rounded bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 ml-2">
                            已禁用
                          </span>
                        )}
                      </div>
                      
                      <p className="text-gray-600 dark:text-gray-400 mb-3 line-clamp-2">
                        {plugin.description}
                      </p>
                      
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
                            {Object.keys(plugin.manifest.permissions || {}).filter(k => plugin.manifest.permissions![k as keyof typeof plugin.manifest.permissions] !== undefined).length} 项权限
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
                      
                      {/* 权限标签 */}
                      {hasPermissions && (
                        <div className="flex flex-wrap gap-2 mt-3">
                          {plugin.manifest.permissions?.fs && (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300">
                              <FaFolderOpen className="w-3 h-3 mr-1" />
                              文件系统
                            </span>
                          )}
                          {plugin.manifest.permissions?.network && (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300">
                              <FaNetworkWired className="w-3 h-3 mr-1" />
                              网络访问
                            </span>
                          )}
                          {plugin.manifest.permissions?.system && (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300">
                              <FaDesktop className="w-3 h-3 mr-1" />
                              系统功能
                            </span>
                          )}
                          {plugin.manifest.permissions?.ui && (
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
                        onClick={() => viewPluginDetails(plugin)}
                        className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors flex items-center justify-center"
                      >
                        <FaInfoCircle className="mr-2" />
                        详情
                      </button>
                      <button
                        onClick={() => togglePlugin(plugin.id)}
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
                        onClick={() => uninstallPlugin(plugin.id)}
                        className="px-4 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-800/30 transition-colors flex items-center justify-center"
                      >
                        <FaTrash className="mr-2" />
                        卸载
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
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
        parsingResult={parsingPlugin}
        loading={loading}
      />

      {/* 插件详情模态框 */}
      {selectedPlugin && (
        <PluginDetailsModal
          isOpen={detailsModalOpen}
          onClose={() => setDetailsModalOpen(false)}
          plugin={selectedPlugin}
          onToggle={() => togglePlugin(selectedPlugin.id)}
          onUninstall={() => {
            uninstallPlugin(selectedPlugin.id);
            setDetailsModalOpen(false);
          }}
        />
      )}
    </div>
  );
};