// src/features/plan-generator/hooks/useNetworkingSettings.ts
// 资源与联网设置：三层的开关 + SearXNG 地址/引擎 + 超时（全部本地 IndexedDB 保存）。
// 默认：只启用第三层（平台跳转按钮），第一/二层需要用户显式开启。
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_NETWORKING_SETTINGS, type NetworkingSettings } from '../types';
import { KV_NETWORKING, kvGet, kvSet } from '../db/plannerDB';

export interface UseNetworkingSettingsResult {
  settings: NetworkingSettings;
  loading: boolean;
  /** 是否开启了任一联网层（UI 用它决定是否显示强提示） */
  networkEnabled: boolean;
  update: (patch: Partial<NetworkingSettings>) => Promise<void>;
  reset: () => Promise<void>;
}

export function useNetworkingSettings(): UseNetworkingSettingsResult {
  const [settings, setSettings] = useState<NetworkingSettings>(DEFAULT_NETWORKING_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    kvGet<NetworkingSettings>(KV_NETWORKING)
      .then((s) => {
        if (alive && s) setSettings({ ...DEFAULT_NETWORKING_SETTINGS, ...s });
      })
      .catch((err) => console.warn('读取联网设置失败:', err))
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const update = useCallback(
    async (patch: Partial<NetworkingSettings>) => {
      const next = { ...settings, ...patch };
      setSettings(next);
      await kvSet(KV_NETWORKING, next);
    },
    [settings],
  );

  const reset = useCallback(async () => {
    setSettings(DEFAULT_NETWORKING_SETTINGS);
    await kvSet(KV_NETWORKING, DEFAULT_NETWORKING_SETTINGS);
  }, []);

  return {
    settings,
    loading,
    networkEnabled: settings.bilibili || settings.searxng,
    update,
    reset,
  };
}
