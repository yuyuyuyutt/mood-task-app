// src/utils/appSettings.ts
// 应用级偏好设置：localStorage 持久化（key 固定，便于将来整体迁移/导出）。
// 注意：目前这些开关只落地"偏好"本身，尚未接入系统通知/国际化运行时——
// 设置页会明确标注，避免用户误以为已生效。
import { useCallback, useState } from 'react';

const STORAGE_KEY = 'mood-task:app-settings:v1';

export interface AppSettings {
  notifications: boolean;
  pushNotifications: boolean;
  soundNotifications: boolean;
  dailyReminder: boolean;
  reminderTime: string;
  language: string;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  notifications: true,
  pushNotifications: true,
  soundNotifications: true,
  dailyReminder: true,
  reminderTime: '20:00',
  language: 'zh-CN',
};

export const APP_SETTINGS_STORAGE_KEY = STORAGE_KEY;

/** 布尔型偏好键（设置页的开关列表用） */
export type BooleanSettingKey =
  | 'notifications'
  | 'pushNotifications'
  | 'soundNotifications'
  | 'dailyReminder';

/** 读取设置；损坏或字段缺失时逐字段回退到默认值 */
export function loadAppSettings(): AppSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_APP_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_APP_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...DEFAULT_APP_SETTINGS, ...parsed };
  } catch (err) {
    console.warn('[app-settings] 读取失败，使用默认值:', err);
    return { ...DEFAULT_APP_SETTINGS };
  }
}

export function saveAppSettings(settings: AppSettings): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn('[app-settings] 保存失败:', err);
  }
}

/** 读取 + 写入一体的轻量 Hook（每次修改立即落盘） */
export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings>(loadAppSettings);

  const update = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      saveAppSettings(next);
      return next;
    });
  }, []);

  return { settings, update };
}
