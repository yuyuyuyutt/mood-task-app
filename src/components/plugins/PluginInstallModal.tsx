// src/components/plugins/PluginInstallModal.tsx
import React, { useState, useCallback } from 'react';
import { FaTimes, FaUpload, FaLink, FaFileCode, FaShieldAlt, FaExclamationTriangle } from 'react-icons/fa';
import { type ParseResult, type PluginManifest } from '../../plugins/parser';

interface PluginInstallModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInstall: (manifest: PluginManifest) => void;
  onFileUpload: (file: File) => Promise<void>;
  parsingResult: ParseResult | null;
  loading: boolean;
}

export const PluginInstallModal: React.FC<PluginInstallModalProps> = ({
  isOpen,
  onClose,
  onInstall,
  onFileUpload,
  parsingResult,
  loading
}) => {
  const [installMethod, setInstallMethod] = useState<'file' | 'url'>('file');
  const [pluginFile, setPluginFile] = useState<File | null>(null);
  const [pluginUrl, setPluginUrl] = useState('');

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPluginFile(file);
      onFileUpload(file);
    }
  }, [onFileUpload]);

  const handleUrlSubmit = useCallback(() => {
    if (pluginUrl) {
      // TODO: 从URL下载并解析插件
      console.log('从URL安装:', pluginUrl);
    }
  }, [pluginUrl]);

  const handleInstall = useCallback(() => {
    if (parsingResult?.success && parsingResult.manifest) {
      onInstall(parsingResult.manifest);
    }
  }, [parsingResult, onInstall]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        {/* 遮罩层 */}
        <div
          className="fixed inset-0 transition-opacity bg-black bg-opacity-50"
          onClick={onClose}
        />

        {/* 模态框内容 */}
        <div className="inline-block align-bottom bg-white dark:bg-gray-800 rounded-xl shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
          <div className="px-6 pt-6 pb-4">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                安装新插件
              </h3>
              <button
                onClick={onClose}
                className="p-2 text-gray-400 hover:text-gray-500 dark:hover:text-gray-300 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <FaTimes className="w-5 h-5" />
              </button>
            </div>

            {/* 安装方式选择 */}
            <div className="flex space-x-2 mb-6">
              <button
                onClick={() => setInstallMethod('file')}
                className={`flex-1 px-4 py-3 rounded-lg transition-colors ${
                  installMethod === 'file'
                    ? 'bg-primary-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                <div className="flex flex-col items-center">
                  <FaUpload className="w-6 h-6 mb-2" />
                  <span className="text-sm font-medium">上传文件</span>
                </div>
              </button>
              <button
                onClick={() => setInstallMethod('url')}
                className={`flex-1 px-4 py-3 rounded-lg transition-colors ${
                  installMethod === 'url'
                    ? 'bg-primary-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                <div className="flex flex-col items-center">
                  <FaLink className="w-6 h-6 mb-2" />
                  <span className="text-sm font-medium">从URL安装</span>
                </div>
              </button>
            </div>

            {/* 文件上传区域 */}
            {installMethod === 'file' && (
              <div className="mb-6">
                <label className="block mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  选择插件文件 (.toml)
                </label>
                <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
                  <div className="space-y-1 text-center">
                    <FaFileCode className="mx-auto h-12 w-12 text-gray-400" />
                    <div className="flex text-sm text-gray-600 dark:text-gray-400">
                      <label className="relative cursor-pointer bg-white dark:bg-gray-700 rounded-md font-medium text-primary-600 dark:text-primary-400 hover:text-primary-500">
                        <span>上传 TOML 文件</span>
                        <input
                          type="file"
                          className="sr-only"
                          accept=".toml,application/toml"
                          onChange={handleFileChange}
                        />
                      </label>
                      <p className="pl-1">或拖拽文件至此</p>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      插件清单文件 (.toml 格式)
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* URL输入区域 */}
            {installMethod === 'url' && (
              <div className="mb-6">
                <label className="block mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  插件清单URL
                </label>
                <div className="flex space-x-2">
                  <input
                    type="url"
                    value={pluginUrl}
                    onChange={(e) => setPluginUrl(e.target.value)}
                    placeholder="https://example.com/plugin.toml"
                    className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                  <button
                    onClick={handleUrlSubmit}
                    className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
                    disabled={!pluginUrl || loading}
                  >
                    获取
                  </button>
                </div>
              </div>
            )}

            {/* 解析结果展示 */}
            {parsingResult && (
              <div className="mb-6">
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  插件信息
                </h4>
                <div className={`p-4 rounded-lg ${
                  parsingResult.success
                    ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
                    : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
                }`}>
                  {parsingResult.success && parsingResult.manifest ? (
                    <div>
                      <div className="flex items-center mb-3">
                        <FaShieldAlt className="w-5 h-5 text-green-500 mr-2" />
                        <h5 className="font-semibold text-green-700 dark:text-green-400">
                          验证通过
                        </h5>
                      </div>
                      <div className="space-y-2">
                        <div>
                          <span className="text-sm text-gray-600 dark:text-gray-400">名称：</span>
                          <span className="font-medium">{parsingResult.manifest.metadata.name}</span>
                        </div>
                        <div>
                          <span className="text-sm text-gray-600 dark:text-gray-400">版本：</span>
                          <span className="font-medium">v{parsingResult.manifest.metadata.version}</span>
                        </div>
                        <div>
                          <span className="text-sm text-gray-600 dark:text-gray-400">作者：</span>
                          <span className="font-medium">{parsingResult.manifest.metadata.author}</span>
                        </div>
                        {parsingResult.manifest.permissions && (
                          <div>
                            <span className="text-sm text-gray-600 dark:text-gray-400">权限：</span>
                            <span className="font-medium">
                              {Object.keys(parsingResult.manifest.permissions).length} 项权限
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center mb-3">
                        <FaExclamationTriangle className="w-5 h-5 text-red-500 mr-2" />
                        <h5 className="font-semibold text-red-700 dark:text-red-400">
                          解析失败
                        </h5>
                      </div>
                      <div className="space-y-1">
                        {parsingResult.errors.map((error, index) => (
                          <p key={index} className="text-sm text-red-600 dark:text-red-400">
                            {error.message}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 底部按钮 */}
          <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900/50 rounded-b-xl flex justify-end space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleInstall}
              disabled={!parsingResult?.success || loading}
              className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '安装中...' : '安装插件'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};