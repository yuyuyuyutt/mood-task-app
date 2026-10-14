// src/pages/Settings.tsx
// 设置页。信息架构取舍：
// - 去掉与页头重复的页面标题与副标题（页头已由 Layout 提供）；
// - 每个分组用「小图标 + 标题」一行表达，不再用大号图标盒子，降低视觉重量；
// - 说明性文字下沉为 title 提示或一行短注，界面本身表达结构。
import React, { useCallback, useState } from 'react';
import {
  FaBell,
  FaMoon,
  FaSun,
  FaCheck,
  FaExclamationCircle,
  FaSpinner,
  FaBorderAll,
  FaPalette,
  FaGlobe,
} from 'react-icons/fa';
import { usePluginHost } from '../plugins/runtime';
import { getBuiltinToml } from '../plugins/builtin';
import { useAppSettings, type BooleanSettingKey } from '../utils/appSettings';
import { DataBackupCard } from '../features/backup/components/DataBackupCard';
import { UserTypeCard } from '../features/plan-generator/components/UserTypeCard';
import { NetworkingSettingsCard } from '../features/plan-generator/components/NetworkingSettingsCard';
import { MemoryCard } from '../features/plan-generator/components/MemoryCard';
import { EmbeddingSettingsCard } from '../features/plan-generator/components/EmbeddingSettingsCard';
import { TracePanel } from '../features/plan-generator/components/TracePanel';

/** 受支持的主题类插件（theme 能力）。同一时刻仅一个主题插件生效。 */
const THEME_PLUGIN_IDS = ['dark-theme', 'wireframe'];

const THEME_OPTIONS: Array<{
  id: string;
  label: string;
  desc: string;
  icon: React.ReactNode;
}> = [
  { id: 'default', label: '默认浅色', desc: '应用默认外观', icon: <FaSun /> },
  { id: 'dark-theme', label: '深色主题', desc: 'dark-theme 插件', icon: <FaMoon /> },
  { id: 'wireframe', label: '黑白线框', desc: 'wireframe 插件', icon: <FaBorderAll /> },
];

/** 分组标题：一行一个，弱化重量 */
const SectionHeader: React.FC<{ icon: React.ReactNode; title: string; hint?: React.ReactNode }> = ({
  icon,
  title,
  hint,
}) => (
  <div className="mb-4 flex items-center gap-2">
    <span className="text-[13px] text-ink-3">{icon}</span>
    <h2 className="text-sm font-semibold text-ink">{title}</h2>
    {hint && <span className="ml-auto text-[11px] text-ink-3">{hint}</span>}
  </div>
);

/** 开关：命中区 44×24，避免精确点击的小目标 */
const Switch: React.FC<{ on: boolean; onToggle: () => void; label: string }> = ({
  on,
  onToggle,
  label,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={label}
    onClick={onToggle}
    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 ease-snap ${
      on ? 'bg-brand' : 'bg-surface-3'
    }`}
  >
    <span
      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-snap ${
        on ? 'translate-x-6' : 'translate-x-1'
      }`}
    />
  </button>
);

export const Settings: React.FC = () => {
  const { plugins, theme, installFromToml, setEnabled, getPlugin } = usePluginHost();
  const activeThemeId = theme.activePluginId;

  const installedThemeIds = plugins
    .filter(
      (p) => p.manifest.capabilities?.theme || p.manifest.capabilities?.code?.kind === 'theme',
    )
    .map((p) => p.id);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const { settings, update } = useAppSettings();

  // 应用某个主题选项：'default' 停用全部主题插件；插件 id 则先装后启用，并互斥其他主题
  const applyThemeOption = useCallback(
    async (id: string) => {
      setBusyId(id);
      setMessage(null);
      try {
        if (id === 'default') {
          for (const pid of THEME_PLUGIN_IDS) {
            const p = getPlugin(pid);
            if (p?.enabled) await setEnabled(pid, false);
          }
          setMessage({ type: 'success', text: '已回到默认浅色外观' });
          return;
        }
        const installed = getPlugin(id);
        if (!installed) {
          const toml = getBuiltinToml(id);
          if (!toml) {
            setMessage({ type: 'error', text: '内置清单缺失，无法安装' });
            return;
          }
          const res = await installFromToml(toml, 'builtin');
          if (!res.ok) {
            setMessage({ type: 'error', text: `安装失败：${res.errors.join('、')}` });
            return;
          }
        }
        for (const pid of THEME_PLUGIN_IDS) {
          if (pid !== id) {
            const other = getPlugin(pid);
            if (other?.enabled) await setEnabled(pid, false);
          }
        }
        const target = getPlugin(id);
        if (target && !target.enabled) await setEnabled(id, true);
        const label = THEME_OPTIONS.find((o) => o.id === id)?.label ?? id;
        setMessage({ type: 'success', text: `已应用「${label}」` });
      } finally {
        setBusyId(null);
      }
    },
    [getPlugin, installFromToml, setEnabled],
  );

  return (
    <div className="space-y-5">
      {message && (
        <div
          className={`panel-in flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-sm ${
            message.type === 'success'
              ? 'bg-ok-soft text-ok'
              : 'bg-danger-soft text-danger'
          }`}
        >
          {message.type === 'success' ? (
            <FaCheck className="mt-0.5 shrink-0 text-[11px]" />
          ) : (
            <FaExclamationCircle className="mt-0.5 shrink-0 text-[11px]" />
          )}
          <p>{message.text}</p>
        </div>
      )}

      {/* 外观 */}
      <section className="card p-5">
        <SectionHeader
          icon={<FaPalette />}
          title="外观"
          hint={<span title="主题能力由插件提供，同一时刻仅一个生效">由插件提供</span>}
        />

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {THEME_OPTIONS.map((opt) => {
            const isPlugin = opt.id !== 'default';
            const installed = !isPlugin || installedThemeIds.includes(opt.id);
            const active = isPlugin ? activeThemeId === opt.id : !activeThemeId;
            const busy = busyId === opt.id;

            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => void applyThemeOption(opt.id)}
                disabled={busy}
                aria-pressed={active}
                className={`relative flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all duration-150 ease-snap active:scale-[0.98] disabled:opacity-50 ${
                  active
                    ? 'border-brand bg-brand-soft'
                    : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2'
                }`}
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm ${
                    active ? 'bg-brand text-white' : 'bg-surface-2 text-ink-2'
                  } ${isPlugin && !installed ? 'opacity-50' : ''}`}
                >
                  {opt.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">
                    {opt.label}
                  </span>
                  <span className="block truncate text-[11px] text-ink-3">
                    {isPlugin && !installed ? '点击安装' : opt.desc}
                  </span>
                </span>
                {busy ? (
                  <FaSpinner className="shrink-0 animate-spin text-[11px] text-brand" />
                ) : active ? (
                  <FaCheck className="shrink-0 text-[11px] text-brand" />
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <label htmlFor="settings-language" className="flex items-center gap-1.5 text-[13px] text-ink-2">
            <FaGlobe className="text-[11px] text-ink-3" />
            语言
          </label>
          <select
            id="settings-language"
            value={settings.language}
            onChange={(e) => update('language', e.target.value)}
            className="input w-auto py-1.5 text-[13px]"
          >
            <option value="zh-CN">简体中文</option>
            <option value="en-US">English</option>
            <option value="ja-JP">日本語</option>
            <option value="ko-KR">한국어</option>
          </select>
        </div>
      </section>

      {/* 通知 */}
      <section className="card p-5">
        <SectionHeader
          icon={<FaBell />}
          title="通知"
          hint={<span title="当前版本只保存偏好，尚未接入系统通知">暂未接入系统通知</span>}
        />

        <div className="divide-y divide-line">
          {(
            [
              { key: 'notifications', label: '启用通知' },
              { key: 'pushNotifications', label: '推送通知' },
              { key: 'soundNotifications', label: '声音提醒' },
              { key: 'dailyReminder', label: '每日提醒' },
            ] as Array<{ key: BooleanSettingKey; label: string }>
          ).map((item) => (
            <div key={item.key} className="flex items-center justify-between py-2.5">
              <span className="text-[13px] text-ink">{item.label}</span>
              <Switch
                on={settings[item.key]}
                label={item.label}
                onToggle={() => update(item.key, !settings[item.key])}
              />
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <label htmlFor="settings-reminder" className="text-[13px] text-ink-2">
            每日提醒时间
          </label>
          <input
            id="settings-reminder"
            type="time"
            value={settings.reminderTime}
            onChange={(e) => update('reminderTime', e.target.value)}
            className="input w-auto py-1.5 text-[13px]"
          />
        </div>
      </section>

      <UserTypeCard />
      <NetworkingSettingsCard />
      <EmbeddingSettingsCard />
      <MemoryCard />
      <TracePanel />
      <DataBackupCard />
    </div>
  );
};
