//src/pages/Settings.tsx
import React, { useCallback, useState } from 'react';
import {
  FaBell,
  FaMoon,
  FaSun,
  FaCheck,
  FaExclamationCircle,
  FaSpinner,
  FaBorderAll,
} from 'react-icons/fa';
import { usePluginHost } from '../plugins/runtime';
import { getBuiltinToml } from '../plugins/builtin';

/** 受支持的主题类插件（theme 能力）。同一时刻仅一个主题插件生效。 */
const THEME_PLUGIN_IDS = ['dark-theme', 'wireframe'];

const THEME_OPTIONS: Array<{
  id: string;
  label: string;
  desc: string;
  icon: React.ReactNode;
  accent: string;
}> = [
  {
    id: 'default',
    label: '默认浅色',
    desc: '不使用主题插件，应用默认外观',
    icon: <FaSun className="w-6 h-6" />,
    accent: 'text-gray-700',
  },
  {
    id: 'dark-theme',
    label: '深色主题',
    desc: '由 dark-theme 插件提供',
    icon: <FaMoon className="w-6 h-6" />,
    accent: 'text-gray-700',
  },
  {
    id: 'wireframe',
    label: '换色主题1',
    desc: '由 wireframe 插件提供',
    icon: <FaBorderAll className="w-6 h-6" />,
    accent: 'text-gray-700',
  },
];

export const Settings: React.FC = () => {
  const {
    plugins,
    theme,
    installFromToml,
    setEnabled,
    getPlugin,
  } = usePluginHost();
  const activeThemeId = theme.activePluginId;

  // 已安装的主题类插件（声明式 theme 能力 + 代码 theme 能力都算）
  const installedThemeIds = plugins
    .filter(
      (p) => p.manifest.capabilities?.theme || p.manifest.capabilities?.code?.kind === 'theme',
    )
    .map((p) => p.id);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [settings, setSettings] = useState({
    // 通知设置
    notifications: true,
    emailNotifications: false,
    pushNotifications: true,
    soundNotifications: true,
    dailyReminder: true,
    reminderTime: '20:00',

    // 显示设置（主题已由插件宿主接管，这里仅保留语言等）
    language: 'zh-CN',
    fontSize: 'medium' as 'small' | 'medium' | 'large',
    compactMode: false,

    // 隐私设置
    privacyMode: false,
    showMoodPublicly: false,

    // 数据管理
    autoSave: true,
    backupFrequency: 'weekly' as 'daily' | 'weekly' | 'monthly',
  });

  const handleChange = (key: keyof typeof settings, value: any) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  // 应用某个主题选项：
  // - 'default'：停用全部主题插件，回到浅色基线；
  // - 插件 id：未安装则先安装（内置 TOML），再停用其他主题插件并启用目标。
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
        // 停用其他主题插件，保证同一时刻只有一个生效
        for (const pid of THEME_PLUGIN_IDS) {
          if (pid !== id) {
            const other = getPlugin(pid);
            if (other?.enabled) await setEnabled(pid, false);
          }
        }
        const target = getPlugin(id);
        if (target && !target.enabled) await setEnabled(id, true);
        setMessage({ type: 'success', text: `已应用「${id === 'dark-theme' ? '深色主题' : '黑白线框 · 荧光'}」` });
      } finally {
        setBusyId(null);
      }
    },
    [getPlugin, installFromToml, setEnabled],
  );

  return (
    <div className="max-w-4xl mx-auto">
      {/* 头部 */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">设置</h1>
        <p className="text-gray-600 mt-2">自定义您的任务管理体验</p>
      </div>

      {/* 消息提示 */}
      {message && (
        <div className={`mb-6 p-4 rounded-lg flex items-start ${message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          {message.type === 'success' ? (
            <FaCheck className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
          ) : (
            <FaExclamationCircle className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
          )}
          <p className="text-sm">{message.text}</p>
        </div>
      )}

      <div className="space-y-8">
        {/* 显示设置 */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center mb-6">
            <div className="p-2 bg-yellow-50 rounded-lg mr-4">
              <FaSun className="w-5 h-5 text-yellow-600" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900">显示设置</h2>
          </div>

          <div className="space-y-6">
            {/* 主题与外观（由主题类插件提供） */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700">
                  主题与外观
                </label>
                <span className="text-xs text-gray-400">
                  主题能力由插件提供 · 同一时刻仅一个生效
                </span>
              </div>
              <p className="text-xs text-gray-500 mb-3">
                选择「深色主题」或「黑白线框」会自动安装并启用对应内置插件；卸载或停用后回到默认浅色。
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {THEME_OPTIONS.map((opt) => {
                  const isPlugin = opt.id !== 'default';
                  const installed = !isPlugin || installedThemeIds.includes(opt.id);
                  const active = isPlugin ? activeThemeId === opt.id : !activeThemeId;
                  const busy = busyId === opt.id;
                  const iconBoxCls = isPlugin && !installed ? 'opacity-60' : '';

                  return (
                    <button
                      key={opt.id}
                      onClick={() => void applyThemeOption(opt.id)}
                      disabled={busy}
                      className={`relative flex flex-col items-start p-4 text-left border transition-colors ${
                        active
                          ? 'border-blue-600 bg-blue-50'
                          : 'border-gray-200 bg-white hover:border-blue-400'
                      } disabled:opacity-60`}
                    >
                      {active && (
                        <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center">
                          <FaCheck className="w-3 h-3" />
                        </span>
                      )}
                      <div className={`w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center mb-3 ${iconBoxCls}`}>
                        {opt.icon}
                      </div>
                      <div className="font-medium text-gray-900 flex items-center">
                        {opt.label}
                        {isPlugin && installed && (
                          <span className="ml-2 text-[10px] font-mono px-1.5 py-0.5 bg-gray-100 text-gray-500">
                            {opt.id}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-1 leading-relaxed">
                        {isPlugin
                          ? installed
                            ? opt.desc
                            : '未安装 · 点击一键安装内置插件'
                          : opt.desc}
                      </div>
                      {busy && (
                        <span className="absolute bottom-2 right-2">
                          <FaSpinner className="w-4 h-4 animate-spin text-blue-600" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                语言
              </label>
              <select
                value={settings.language}
                onChange={(e) => handleChange('language', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900"
              >
                <option value="zh-CN">简体中文</option>
                <option value="en-US">English</option>
                <option value="ja-JP">日本語</option>
                <option value="ko-KR">한국어</option>
              </select>
            </div>
          </div>
        </div>

        {/* 通知设置 */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center mb-6">
            <div className="p-2 bg-green-50 rounded-lg mr-4">
              <FaBell className="w-5 h-5 text-green-600" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900">通知设置</h2>
          </div>

          <div className="space-y-4">
            {[
              { key: 'notifications', label: '启用通知', description: '接收任务提醒和更新' },
              { key: 'pushNotifications', label: '推送通知', description: '在设备上接收推送通知' },
              { key: 'soundNotifications', label: '声音提醒', description: '任务提醒时播放声音' },
              { key: 'dailyReminder', label: '每日提醒', description: '每天提醒待办任务' },
            ].map((item) => (
              <div key={item.key} className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium text-gray-900">{item.label}</div>
                  <div className="text-sm text-gray-500">{item.description}</div>
                </div>
                <button
                  onClick={() => handleChange(item.key as any, !settings[item.key as keyof typeof settings])}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${settings[item.key as keyof typeof settings] ? 'bg-blue-600' : 'bg-gray-200 hover:bg-gray-300'}`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${settings[item.key as keyof typeof settings] ? 'translate-x-6' : 'translate-x-1'}`}
                  />
                </button>
              </div>
            ))}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                每日提醒时间
              </label>
              <input
                type="time"
                value={settings.reminderTime}
                onChange={(e) => handleChange('reminderTime', e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
