// src/features/plan-generator/components/wizard/ResourceStep.tsx
// 阶段 2：资源检索。
// 展示：检索关键词（含优先级与理由）、三层状态与降级说明、真实资源（打分/元数据/链接）、
//      平台跳转按钮（第三层）、资源库管理入口。
import React from 'react';
import { handleExternalLink } from '../../../../utils/openExternal';
import {
  FaSpinner,
  FaExclamationTriangle,
  FaArrowLeft,
  FaArrowRight,
  FaSearch,
  FaExternalLinkAlt,
  FaVideo,
  FaBook,
  FaNewspaper,
  FaCode,
  FaLink,
  FaCheckCircle,
  FaMinusCircle,
  FaShieldAlt,
} from 'react-icons/fa';
import type {
  KeywordResult,
  ManualResource,
  NetworkingSettings,
  ResourceBundle,
  ResourceItem,
  ResourceType,
} from '../../types';
import { ResourceLibraryPanel } from '../ResourceLibraryPanel';

interface Props {
  keywords: KeywordResult | null;
  bundle: ResourceBundle | null;
  loading: boolean;
  error: string | null;
  settings: NetworkingSettings;
  manualResources: ManualResource[];
  /** 联网层是否开启（用于隐私提示强度） */
  networkEnabled: boolean;
  onBack: () => void;
  onNext: () => void;
  onRetry: () => void;
  onOpenSettings: () => void;
  onManualChanged: () => void;
}

const TYPE_ICON: Record<ResourceType, React.ReactNode> = {
  video: <FaVideo className="w-3.5 h-3.5" />,
  article: <FaNewspaper className="w-3.5 h-3.5" />,
  book: <FaBook className="w-3.5 h-3.5" />,
  post: <FaCode className="w-3.5 h-3.5" />,
  link: <FaLink className="w-3.5 h-3.5" />,
};

const TYPE_LABEL: Record<ResourceType, string> = {
  video: '视频',
  article: '文章',
  book: '书籍',
  post: '帖子/仓库',
  link: '链接',
};

const SOURCE_LABEL: Record<string, string> = {
  bilibili: 'B 站',
  searxng: 'SearXNG',
  manual: '我的资源库',
  jump: '跳转',
};

const LAYER_LABEL: Record<number, string> = {
  1: '第一层 · B 站搜索 API',
  2: '第二层 · SearXNG',
  3: '第三层 · 平台跳转按钮',
};

function scoreBadge(item: ResourceItem): string {
  const s = item.score ?? 0;
  if (s >= 0.75) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
  if (s >= 0.6) return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
  return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
}

export const ResourceStep: React.FC<Props> = ({
  keywords,
  bundle,
  loading,
  error,
  settings,
  manualResources,
  networkEnabled,
  onBack,
  onNext,
  onRetry,
  onOpenSettings,
  onManualChanged,
}) => {
  const items = bundle?.items ?? [];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
      <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center">
          <FaSearch className="w-4 h-4 mr-2 text-primary-500" />
          第 2 步 · 资源检索
        </h3>
        <button onClick={onOpenSettings} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
          资源与联网设置
        </button>
      </div>

      <div className="p-5 space-y-4">
        {/* 隐私提示 */}
        <div
          className={`flex items-start gap-2 px-3 py-2.5 rounded-lg text-xs border ${
            networkEnabled
              ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'
              : 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
          }`}
        >
          {networkEnabled ? (
            <FaExclamationTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          ) : (
            <FaShieldAlt className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          )}
          <span>
            {networkEnabled ? (
              <>
                已开启联网检索：会把<b>检索关键词</b>发送给{' '}
                {settings.bilibili ? 'B 站公开接口' : ''}
                {settings.bilibili && settings.searxng ? ' 与 ' : ''}
                {settings.searxng ? `本地 SearXNG（${settings.searxngBaseUrl}）` : ''}
                。所有请求 {settings.timeoutMs}ms 超时，失败自动降级；只保存标题/链接/元数据，不保存正文。
              </>
            ) : (
              <>
                当前为<b>纯本地模式</b>：不发起任何检索请求，只生成平台跳转按钮（点击后由浏览器打开对应平台搜索页）。
                可在"资源与联网设置"中开启 B 站搜索或本地 SearXNG。
              </>
            )}
          </span>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-10 text-gray-500 dark:text-gray-400">
            <FaSpinner className="w-5 h-5 mr-2 animate-spin" />
            正在提取关键词并检索资源…
          </div>
        )}

        {!loading && error && (
          <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 flex items-start">
            <FaExclamationTriangle className="w-4 h-4 text-red-500 mr-2 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-red-700 dark:text-red-300">
              <p>{error}</p>
              <button onClick={onRetry} className="mt-1.5 text-xs underline">
                重试
              </button>
            </div>
          </div>
        )}

        {!loading && keywords && (
          <>
            {/* 检索关键词 */}
            <div>
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center">
                检索关键词
                {keywords.source === 'template' && (
                  <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                    模板兜底{keywords.fallbackReason ? `：${keywords.fallbackReason}` : ''}
                  </span>
                )}
              </h4>
              <ul className="space-y-1.5">
                {keywords.keywords.map((k) => (
                  <li key={k.keyword} className="flex items-start gap-2 text-xs">
                    <span
                      className={`mt-0.5 px-1.5 py-0.5 rounded font-mono ${
                        k.priority === 1
                          ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                      }`}
                    >
                      P{k.priority}
                    </span>
                    <span className="font-medium text-gray-800 dark:text-gray-200">{k.keyword}</span>
                    <span className="text-gray-400">— {k.reason}</span>
                    {k.lang === 'en' && <span className="text-gray-400">（英文资料）</span>}
                  </li>
                ))}
              </ul>
            </div>

            {/* 三层状态 */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(bundle?.layers ?? []).map((layer) => (
                <div
                  key={layer.layer}
                  className="rounded-lg border border-gray-200 dark:border-gray-700 p-2.5 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500 dark:text-gray-400">{LAYER_LABEL[layer.layer]}</span>
                    {layer.enabled ? (
                      layer.ok ? (
                        <FaCheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <FaExclamationTriangle className="w-3.5 h-3.5 text-amber-500" />
                      )
                    ) : (
                      <FaMinusCircle className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600" />
                    )}
                  </div>
                  <div className="mt-1 text-gray-700 dark:text-gray-300">
                    {layer.enabled ? (layer.ok ? `${layer.count} 条` : '已降级') : '未开启'}
                  </div>
                  {layer.note && <div className="text-[11px] text-gray-400 mt-0.5 truncate" title={layer.note}>{layer.note}</div>}
                </div>
              ))}
            </div>

            {/* 降级/安全说明 */}
            {(bundle?.warnings?.length ?? 0) > 0 && (
              <ul className="space-y-1">
                {bundle!.warnings.map((w, i) => (
                  <li key={i} className="text-[11px] text-amber-600 dark:text-amber-400 flex items-start">
                    <FaExclamationTriangle className="w-3 h-3 mr-1 mt-0.5 flex-shrink-0" />
                    {w}
                  </li>
                ))}
              </ul>
            )}

            {/* 资源列表（按类型分组） */}
            {items.length > 0 && (
              <div className="space-y-3">
                {(Object.keys(bundle!.grouped) as ResourceType[])
                  .filter((t) => bundle!.grouped[t].length > 0)
                  .map((t) => (
                    <div key={t}>
                      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 flex items-center">
                        {TYPE_ICON[t]}
                        <span className="ml-1.5">{TYPE_LABEL[t]}</span>
                        <span className="ml-2 text-xs text-gray-400">{bundle!.grouped[t].length} 条</span>
                      </h4>
                      <ul className="space-y-1.5">
                        {bundle!.grouped[t].map((item) => (
                          <li
                            key={item.id}
                            className="rounded-lg border border-gray-200 dark:border-gray-700 p-2.5"
                          >
                            <div className="flex items-start gap-2">
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noreferrer noopener"
                                onClick={(e) => handleExternalLink(e, item.url)}
                                className="flex-1 min-w-0 text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline break-words"
                              >
                                {item.title}
                                <FaExternalLinkAlt className="w-2.5 h-2.5 inline ml-1 opacity-60" />
                              </a>
                              <span className={`text-[11px] px-1.5 py-0.5 rounded whitespace-nowrap ${scoreBadge(item)}`}>
                                {(item.score ?? 0).toFixed(2)}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-400">
                              <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                                {SOURCE_LABEL[item.source] ?? item.source}
                              </span>
                              {item.author && <span>{item.author}</span>}
                              {item.durationMinutes != null && <span>{item.durationMinutes} 分钟</span>}
                              {item.metrics?.views != null && (
                                <span>{formatCount(item.metrics.views)} 播放</span>
                              )}
                              {item.publishedAt && <span>{item.publishedAt}</span>}
                              {item.difficulty && item.difficulty !== 'unknown' && (
                                <span>难度：{difficultyLabel(item.difficulty)}</span>
                              )}
                              {item.keyword && <span>关键词：{item.keyword}</span>}
                            </div>
                            {item.snippet && (
                              <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400 line-clamp-2">
                                {item.snippet}
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
              </div>
            )}

            {/* 第三层：跳转按钮 */}
            {bundle && bundle.jumpGroups.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  平台跳转（不联网，点击后在新标签页打开）
                </h4>
                <div className="space-y-2">
                  {bundle.jumpGroups.map((group) => (
                    <div key={group.keyword} className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-gray-500 dark:text-gray-400 mr-1">{group.keyword}</span>
                      {group.links.map((link) => (
                        <a
                          key={`${group.keyword}-${link.platform}`}
                          href={link.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          onClick={(e) => handleExternalLink(e, link.url)}
                          className="px-2 py-1 rounded-md text-[11px] bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                        >
                          {link.label}
                        </a>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 资源库 */}
            <ResourceLibraryPanel onChanged={onManualChanged} />
            {manualResources.length > 0 && (
              <p className="text-[11px] text-gray-400">
                资源库现有 {manualResources.length} 条，命中当前关键词的条目会并入上方候选列表。
              </p>
            )}
          </>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            onClick={onBack}
            className="inline-flex items-center px-3 py-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            <FaArrowLeft className="w-3 h-3 mr-1.5" />
            上一步
          </button>
          <div className="flex items-center gap-2">
            {!loading && (
              <button
                onClick={onRetry}
                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              >
                重新检索
              </button>
            )}
            <button
              onClick={onNext}
              disabled={loading || !bundle}
              className="inline-flex items-center px-5 py-2.5 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              下一步：生成计划
              <FaArrowRight className="w-3 h-3 ml-2" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

function formatCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万`;
  return String(n);
}

function difficultyLabel(d: string): string {
  if (d === 'beginner') return '入门';
  if (d === 'intermediate') return '进阶';
  if (d === 'advanced') return '深入';
  return '未知';
}
