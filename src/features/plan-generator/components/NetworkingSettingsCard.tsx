// src/features/plan-generator/components/NetworkingSettingsCard.tsx
// 设置页"资源与联网"卡片：管理三层资源的开关、SearXNG 地址/引擎、超时与偏好难度。
// 默认：只启用第三层（跳转按钮）；开启联网层时给出明确提示。
import React, { useState } from 'react';
import {
  FaWifi,
  FaShieldAlt,
  FaExclamationTriangle,
  FaServer,
  FaLink,
  FaDatabase,
  FaSpinner,
  FaCheckCircle,
  FaTimesCircle,
} from 'react-icons/fa';
import { useNetworkingSettings } from '../hooks/useNetworkingSettings';
import { useResourceLibrary } from '../hooks/useResourceLibrary';
import { ResourceLibraryPanel } from './ResourceLibraryPanel';
import { SEARXNG_SETUP_HINT } from '../services/prompts';
import type { ResourceDifficulty } from '../types';

/** 可用于按引擎限定 SearXNG 搜索范围（SearXNG 内置引擎名） */
const COMMON_ENGINES = ['douban', 'zhihu', 'juejin', 'github', 'wikipedia', 'bing'];

export const NetworkingSettingsCard: React.FC = () => {
  const { settings, loading, networkEnabled, update } = useNetworkingSettings();
  const { resources } = useResourceLibrary();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const testSearxng = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const base = settings.searxngBaseUrl.replace(/\/+$/, '');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), settings.timeoutMs || 5000);
      const res = await fetch(`${base}/search?q=test&format=json`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) {
        setTestResult({ ok: false, message: `HTTP ${res.status}（请确认已开启 json 格式）` });
        return;
      }
      const data = (await res.json()) as { results?: unknown[] };
      setTestResult({
        ok: true,
        message: `连接成功，返回 ${Array.isArray(data.results) ? data.results.length : 0} 条结果`,
      });
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  };

  const toggleEngine = (engine: string) => {
    const next = settings.searxngEngines.includes(engine)
      ? settings.searxngEngines.filter((e) => e !== engine)
      : [...settings.searxngEngines, engine];
    void update({ searxngEngines: next });
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm p-6 flex items-center text-gray-400 text-sm">
        <FaSpinner className="w-4 h-4 mr-2 animate-spin" />
        读取联网设置…
      </div>
    );
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center">
          <div className="p-2 bg-sky-50 rounded-lg mr-3">
            <FaWifi className="w-5 h-5 text-sky-600" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900">资源与联网</h2>
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-3">
              <FaShieldAlt className="text-[10px]" />
              仅保存标题与链接，不保存网页正文
            </p>
          </div>
        </div>
        <span
          className={`text-xs px-2 py-1 rounded-full ${
            networkEnabled
              ? 'bg-amber-50 text-amber-700 border border-amber-200'
              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
          }`}
        >
          {networkEnabled ? '已开启联网检索' : '纯本地模式'}
        </span>
      </div>

      <div className="space-y-4">
        {/* 第一层 */}
        <LayerRow
          index={1}
          icon={<FaServer className="w-4 h-4 text-blue-500" />}
          title="B 站搜索 API"
          desc="返回真实视频链接、标题、UP 主、时长、播放量（需要直连 api.bilibili.com，浏览器可能受 CORS 限制而自动降级）"
          enabled={settings.bilibili}
          onToggle={(v) => void update({ bilibili: v })}
        />

        {/* 第二层 */}
        <LayerRow
          index={2}
          icon={<FaDatabase className="w-4 h-4 text-emerald-500" />}
          title="SearXNG（本地实例）"
          desc="补充文章、书籍、技术帖等非视频资源；未配置或失败会自动跳过"
          enabled={settings.searxng}
          onToggle={(v) => void update({ searxng: v })}
        />

        {settings.searxng && (
          <div className="ml-7 space-y-3 rounded-lg bg-gray-50 p-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">SearXNG 地址</label>
              <div className="flex gap-2">
                <input
                  value={settings.searxngBaseUrl}
                  onChange={(e) => void update({ searxngBaseUrl: e.target.value })}
                  placeholder="http://localhost:8888"
                  className="flex-1 min-w-0 px-2.5 py-2 border border-gray-300 rounded-lg bg-white text-xs font-mono text-gray-800"
                />
                <button
                  onClick={() => void testSearxng()}
                  disabled={testing}
                  className="px-3 py-2 rounded-lg bg-gray-900 text-white text-xs whitespace-nowrap inline-flex items-center disabled:opacity-60"
                >
                  {testing ? <FaSpinner className="w-3 h-3 mr-1 animate-spin" /> : null}
                  测试连接
                </button>
              </div>
              {testResult && (
                <p
                  className={`mt-1.5 text-xs flex items-center ${
                    testResult.ok ? 'text-emerald-600' : 'text-red-500'
                  }`}
                >
                  {testResult.ok ? (
                    <FaCheckCircle className="w-3 h-3 mr-1" />
                  ) : (
                    <FaTimesCircle className="w-3 h-3 mr-1" />
                  )}
                  {testResult.message}
                </p>
              )}
              <p className="mt-1 text-[11px] text-gray-400">{SEARXNG_SETUP_HINT}</p>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1.5">
                只搜索这些引擎（不选 = 不限引擎）
              </label>
              <div className="flex flex-wrap gap-1.5">
                {COMMON_ENGINES.map((engine) => {
                  const active = settings.searxngEngines.includes(engine);
                  return (
                    <button
                      key={engine}
                      onClick={() => toggleEngine(engine)}
                      className={`px-2 py-1 rounded-full text-[11px] border transition-colors ${
                        active
                          ? 'bg-emerald-500 border-emerald-500 text-white'
                          : 'border-gray-300 text-gray-600 hover:border-emerald-400'
                      }`}
                    >
                      {engine}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* 第三层 */}
        <LayerRow
          index={3}
          icon={<FaLink className="w-4 h-4 text-violet-500" />}
          title="平台跳转按钮（兜底，默认开启）"
          desc="不抓取任何数据，只为每个关键词生成 B 站/豆瓣/小红书/抖音/知乎/掘金 的搜索页按钮"
          enabled={settings.jumpLinks}
          onToggle={(v) => void update({ jumpLinks: v })}
        />

        {/* 通用参数 */}
        <div className="ml-7 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">单次请求超时（毫秒）</label>
            <input
              type="number"
              min={1000}
              max={15000}
              step={500}
              value={settings.timeoutMs}
              onChange={(e) => void update({ timeoutMs: Math.min(15000, Math.max(1000, Number(e.target.value) || 5000)) })}
              className="w-full px-2.5 py-2 border border-gray-300 rounded-lg bg-white text-xs text-gray-800"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">偏好难度（影响资源排序）</label>
            <select
              value={settings.preferredDifficulty}
              onChange={(e) => void update({ preferredDifficulty: e.target.value as ResourceDifficulty })}
              className="w-full px-2.5 py-2 border border-gray-300 rounded-lg bg-white text-xs text-gray-800"
            >
              <option value="unknown">不确定 / 自动</option>
              <option value="beginner">入门</option>
              <option value="intermediate">进阶</option>
              <option value="advanced">深入</option>
            </select>
          </div>
        </div>

        {networkEnabled && (
          <div className="ml-7 flex items-start p-2.5 rounded-lg bg-amber-50 border border-amber-200">
            <FaExclamationTriangle className="w-3.5 h-3.5 text-amber-500 mr-2 mt-0.5 flex-shrink-0" />
            <p className="text-[11px] text-amber-700 leading-relaxed">
              开启联网后会发送<b>检索关键词</b>（由你的目标与澄清回答生成）到
              {settings.bilibili ? ' B 站公开接口' : ''}
              {settings.bilibili && settings.searxng ? ' 与 ' : ''}
              {settings.searxng ? ' 你配置的 SearXNG 实例' : ''}
              。不会发送任务内容、心情记录或头像。
              {settings.searxng &&
                !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(settings.searxngBaseUrl) &&
                '⚠ 当前 SearXNG 地址不是本机地址。'}
            </p>
          </div>
        )}

        {/* 资源库 */}
        <div className="pt-1">
          <p className="text-xs text-gray-500 mb-2">我的资源库（{resources.length} 条，可手动添加并在检索时并入）</p>
          <ResourceLibraryPanel />
        </div>
      </div>
    </div>
  );
};

function LayerRow(props: {
  index: number;
  icon: React.ReactNode;
  title: string;
  desc: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start">
        <span className="mt-0.5 mr-3">{props.icon}</span>
        <div>
          <p className="text-sm font-medium text-gray-800">
            第 {props.index} 层 · {props.title}
          </p>
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{props.desc}</p>
        </div>
      </div>
      <button
        onClick={() => props.onToggle(!props.enabled)}
        role="switch"
        aria-checked={props.enabled}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
          props.enabled ? 'bg-blue-600' : 'bg-gray-200 hover:bg-gray-300'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${
            props.enabled ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}
