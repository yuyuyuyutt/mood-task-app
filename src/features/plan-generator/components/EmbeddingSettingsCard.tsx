// src/features/plan-generator/components/EmbeddingSettingsCard.tsx
// 设置页「语义检索（本地向量）」卡片：
// - 开关 + embedding 模型（端点沿用 AI 增强里的本地模型地址，只读展示）；
// - "测试"按钮跑一次真实的最小 embedding 请求，并报出向量维度（换模型维度会变，最容易看出问题）；
// - 索引概况（已索引 N 条 / 维度 / 存在哪个存储）与"清空索引"（索引是可重建的派生数据）。
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FaProjectDiagram,
  FaSpinner,
  FaCheckCircle,
  FaTimesCircle,
  FaTrash,
  FaSyncAlt,
} from 'react-icons/fa';
import { useEmbeddingSettings } from '../hooks/useEmbeddingSettings';
import { probeEmbedding, SUGGESTED_EMBEDDING_MODELS } from '../services/rag/embedding';
import { EMBEDDING_NAMESPACE_RESOURCE } from '../services/rag/embedding';
import { createVectorStore, type VectorBackendStat } from '../services/rag/vectorStore';
import { clearContentCache, summarizeContentCache } from '../services/rag/contentCache';
import { SUGGESTED_CONTENT_DOMAINS } from '../types';

export const EmbeddingSettingsCard: React.FC = () => {
  const { settings, loading, endpoint, update } = useEmbeddingSettings();
  const storeRef = useRef(createVectorStore());
  const [testing, setTesting] = useState(false);
  const [probe, setProbe] = useState<{ ok: boolean; message: string } | null>(null);
  const [stats, setStats] = useState<VectorBackendStat[]>([]);
  const [cache, setCache] = useState<{ total: number; fresh: number; chars: number }>({
    total: 0,
    fresh: 0,
    chars: 0,
  });
  const [domainInput, setDomainInput] = useState('');
  const [busy, setBusy] = useState(false);

  const refreshStats = useCallback(async () => {
    try {
      setStats(await storeRef.current.stats());
    } catch (err) {
      console.warn('读取向量索引概况失败:', err);
      setStats([]);
    }
    try {
      setCache(await summarizeContentCache());
    } catch {
      setCache({ total: 0, fresh: 0, chars: 0 });
    }
  }, []);

  const addDomain = async (raw: string) => {
    const parts = raw
      .split(/[\s,，、;；]+/)
      .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''))
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = Array.from(new Set([...settings.allowedDomains, ...parts]));
    setDomainInput('');
    await update({ allowedDomains: next });
  };

  const removeDomain = async (domain: string) => {
    await update({ allowedDomains: settings.allowedDomains.filter((d) => d !== domain) });
  };

  useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  const test = async () => {
    setTesting(true);
    setProbe(null);
    try {
      const result = await probeEmbedding(endpoint, settings.model, settings.timeoutMs);
      setProbe({
        ok: result.ok,
        message: result.ok
          ? `连接成功，向量维度 ${result.dim}`
          : (result.error ?? '未知错误'),
      });
      if (result.ok) await refreshStats();
    } finally {
      setTesting(false);
    }
  };

  const clearIndex = async () => {
    setBusy(true);
    try {
      await storeRef.current.clear(EMBEDDING_NAMESPACE_RESOURCE);
      await refreshStats();
    } catch (err) {
      setProbe({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const resourceIndex = stats.filter((s) => s.namespace === EMBEDDING_NAMESPACE_RESOURCE);
  const totalIndexed = resourceIndex.reduce((sum, s) => sum + s.count, 0);
  const storeLabel = storeRef.current.kind === 'tauri' ? 'SQLite' : 'IndexedDB';

  if (loading) {
    return (
      <div className="card p-5 flex items-center text-gray-400 text-sm">
        <FaSpinner className="w-4 h-4 mr-2 animate-spin" />
        读取语义检索设置…
      </div>
    );
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center">
          <div className="p-2 rounded-lg bg-teal-50 mr-3">
            <FaProjectDiagram className="w-5 h-5 text-teal-600" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              语义检索（本地向量）
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              用本地 embedding 模型理解资源语义，与关键词排序做 RRF 融合；向量与计算都不出本机。
            </p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => void update({ enabled: e.target.checked })}
            className="w-4 h-4 rounded"
          />
          启用语义检索
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Embedding 模型</label>
          <input
            value={settings.model}
            onChange={(e) => void update({ model: e.target.value.trim() })}
            list="embedding-model-options"
            placeholder="nomic-embed-text"
            className="w-full px-2.5 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-xs font-mono text-gray-800 dark:text-gray-100"
          />
          <datalist id="embedding-model-options">
            {SUGGESTED_EMBEDDING_MODELS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <p className="mt-1 text-[11px] text-gray-400">
            需先在本地拉取：`ollama pull {settings.model || 'nomic-embed-text'}`
          </p>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">模型端点（沿用 AI 增强配置）</label>
          <input
            value={endpoint}
            readOnly
            className="w-full px-2.5 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-800 text-xs font-mono text-gray-500"
          />
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <button
              onClick={() => void test()}
              disabled={testing || !settings.model}
              className="inline-flex items-center px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs whitespace-nowrap disabled:opacity-60"
            >
              {testing ? (
                <FaSpinner className="w-3 h-3 mr-1.5 animate-spin" />
              ) : (
                <FaSyncAlt className="w-3 h-3 mr-1.5" />
              )}
              测试连通性
            </button>
            <span className="text-[11px] text-gray-400">超时 {settings.timeoutMs} ms</span>
          </div>
          {probe && (
            <p
              className={`mt-1.5 text-xs flex items-start ${
                probe.ok ? 'text-emerald-600' : 'text-red-500'
              }`}
            >
              {probe.ok ? (
                <FaCheckCircle className="w-3 h-3 mr-1 mt-0.5 shrink-0" />
              ) : (
                <FaTimesCircle className="w-3 h-3 mr-1 mt-0.5 shrink-0" />
              )}
              <span className="leading-relaxed">{probe.message}</span>
            </p>
          )}
        </div>
      </div>

      <div className="rounded-lg bg-gray-50 dark:bg-gray-700/40 p-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-gray-600 dark:text-gray-300">
          资源索引：
          <span className="font-semibold text-gray-900 dark:text-gray-100"> {totalIndexed} </span>
          条 · 存储 {storeLabel}
          {resourceIndex.length > 0 && (
            <span className="text-gray-400">
              （{resourceIndex.map((s) => `${s.model} ${s.dim} 维`).join('，')}）
            </span>
          )}
          {totalIndexed === 0 && (
            <span className="text-gray-400">· 首次生成计划时会自动建立</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void refreshStats()}
            className="inline-flex items-center px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 text-gray-600 text-xs"
          >
            <FaSyncAlt className="w-3 h-3 mr-1.5" />
            刷新
          </button>
          <button
            onClick={() => {
              if (window.confirm(`清空 ${totalIndexed} 条向量索引？（下次检索会重新计算，原始数据不受影响）`)) {
                void clearIndex();
              }
            }}
            disabled={busy || totalIndexed === 0}
            className="inline-flex items-center px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 text-gray-600 text-xs disabled:opacity-50"
          >
            {busy ? <FaSpinner className="w-3 h-3 mr-1.5 animate-spin" /> : <FaTrash className="w-3 h-3 mr-1.5" />}
            清空索引
          </button>
        </div>
      </div>

      <p className="mt-3 text-[11px] text-gray-400 leading-relaxed">
        索引是派生数据：只保存向量的数值，不保存网页正文，也不进入数据备份（随时可重建）。
        未开启或模型不可用时，检索会自动退回纯关键词排序，计划生成不受影响。
      </p>

      {/* ---------- 正文抓取（P4：内容级 RAG） ---------- */}
      <div className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-700">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
              正文抓取（内容级 RAG）
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
              抓取白名单内资源的正文并分块，只把与目标最相关的几块作为证据注入计划生成；
              未开启时模型只能看到标题与链接。
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 shrink-0">
            <input
              type="checkbox"
              checked={settings.contentFetch}
              disabled={!settings.enabled}
              onChange={(e) => void update({ contentFetch: e.target.checked })}
              className="w-4 h-4 rounded disabled:opacity-50"
            />
            启用
          </label>
        </div>

        {!settings.enabled && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 mb-2">
            需先开启上方的「启用语义检索」——正文证据要用向量挑出最相关的片段。
          </p>
        )}

        <div className={settings.enabled && settings.contentFetch ? 'space-y-3' : 'space-y-3 opacity-60'}>
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">
              允许抓取的域名（{settings.allowedDomains.length} 个，留空 = 不抓任何站点）
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {settings.allowedDomains.map((domain) => (
                <span
                  key={domain}
                  className="inline-flex items-center px-2 py-1 rounded-full text-[11px] bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800"
                >
                  {domain}
                  <button
                    onClick={() => void removeDomain(domain)}
                    className="ml-1.5 text-teal-500 hover:text-red-500"
                    title="移除"
                  >
                    ×
                  </button>
                </span>
              ))}
              {settings.allowedDomains.length === 0 && (
                <span className="text-[11px] text-gray-400">尚未添加任何域名</span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                value={domainInput}
                onChange={(e) => setDomainInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void addDomain(domainInput);
                }}
                placeholder="例如 bilibili.com"
                className="flex-1 min-w-0 px-2.5 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-xs font-mono text-gray-800 dark:text-gray-100"
              />
              <button
                onClick={() => void addDomain(domainInput)}
                className="px-3 py-2 rounded-lg bg-gray-900 text-white text-xs whitespace-nowrap"
              >
                添加
              </button>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {SUGGESTED_CONTENT_DOMAINS.filter((d) => !settings.allowedDomains.includes(d)).map(
                (domain) => (
                  <button
                    key={domain}
                    onClick={() => void addDomain(domain)}
                    className="px-2 py-0.5 rounded-full text-[11px] border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-teal-400 hover:text-teal-600"
                  >
                    + {domain}
                  </button>
                ),
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">单次最多抓取页面数</label>
              <input
                type="number"
                min={1}
                max={5}
                value={settings.maxResources}
                onChange={(e) =>
                  void update({ maxResources: Math.min(5, Math.max(1, Number(e.target.value) || 3)) })
                }
                className="w-full px-2.5 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-xs text-gray-800 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">注入 prompt 的证据块数</label>
              <input
                type="number"
                min={1}
                max={12}
                value={settings.maxChunks}
                onChange={(e) =>
                  void update({ maxChunks: Math.min(12, Math.max(1, Number(e.target.value) || 6)) })
                }
                className="w-full px-2.5 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-xs text-gray-800 dark:text-gray-100"
              />
            </div>
          </div>

          <div className="rounded-lg bg-gray-50 dark:bg-gray-700/40 p-3 flex items-center justify-between gap-3 flex-wrap">
            <span className="text-xs text-gray-600 dark:text-gray-300">
              已缓存正文：
              <span className="font-semibold text-gray-900 dark:text-gray-100"> {cache.fresh} </span>
              页（约 {Math.round(cache.chars / 1000)}k 字）
              <span className="text-gray-400"> · 7 天过期 · 不进数据备份</span>
            </span>
            <button
              onClick={() => {
                if (window.confirm('清除已抓取的网页正文缓存？（下次会重新抓取）')) {
                  void clearContentCache().then(refreshStats);
                }
              }}
              disabled={cache.fresh === 0}
              className="inline-flex items-center px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 text-gray-600 text-xs disabled:opacity-50"
            >
              <FaTrash className="w-3 h-3 mr-1.5" />
              清除正文缓存
            </button>
          </div>

          <p className="text-[11px] text-gray-400 leading-relaxed">
            只抓取列表内的域名；抓到的正文存在本机独立缓存里（7 天过期、不进备份、可随时清除），
            注入模型时会包成「外部内容｜不可信数据」并在 system 里声明其不构成指令。
            桌面端经 Rust 代理抓取（浏览器模式通常会被同源策略拦截）。
          </p>
        </div>
      </div>
    </div>
  );
};
