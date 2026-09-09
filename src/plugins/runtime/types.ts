// src/plugins/runtime/types.ts
import type { PluginManifest } from '../parser/types';

/** 宿主核心版本：插件清单中的 minCoreVersion 与之比较 */
export const CORE_VERSION = '1.0.0';

/** 浏览器端持久化键（Tauri 环境下与 AppData 文件互为镜像） */
export const STORAGE_KEY = 'mood-task:plugins:v1';

/** Tauri AppData 中的插件注册表文件 */
export const PLUGINS_FILE = 'plugins/installed.json';

/** 主题偏好键：记录最近一次主题模式（供插件跟随系统偏好时参考） */
export const THEME_PREF_KEY = 'mood-task:theme:preference';

export type PluginSource = 'builtin' | 'file' | 'url';

/** 已安装插件的运行时记录 */
export interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  manifest: PluginManifest;
  enabled: boolean;
  installedAt: string;
  source: PluginSource;
}

/** 数据操作类型（与清单 capabilities.data.operations 对应） */
export type DataOp = 'read' | 'write' | 'delete';

/** 命名空间数据记录 */
export interface DataRecord {
  key: string;
  value: unknown;
  updatedAt: string;
}

/** 卸载墓碑：插件数据进入保留期，到期自动清除 */
export interface Tombstone {
  /** 插件 id */
  pluginId: string;
  /** 卸载时间戳（ms） */
  uninstalledAt: number;
  /** 保留天数 */
  retentionDays: number;
  /** 插件名（回收站展示用） */
  pluginName: string;
  /** 数据命名空间（到期时按此清除） */
  namespace?: string;
}

/** 由启用的页面能力插件贡献的页面信息 */
export interface PluginPageInfo {
  pluginId: string;
  pageId: string;
  path: string;
  title: string;
  icon?: string;
  showInNav: boolean;
}

export type ThemeMode = 'light' | 'dark';

/** 宿主当前的主题状态（由主题能力插件驱动） */
export interface ThemeState {
  mode: ThemeMode;
  /** 当前提供主题能力的插件 id；无主题插件时为 null */
  activePluginId: string | null;
}

/** 沙箱代码插件通过消息协议提交给宿主的"主题应用规格" */
export interface SandboxThemeSpec {
  className?: string;
  mode?: ThemeMode;
  /** 设计令牌（CSS 自定义属性，如 --accent/--ink/--paper） */
  tokens?: Record<string, string>;
  /** 强调色（简写，等价 tokens['--accent']） */
  accent?: string;
  /** 随主题注入的整站样式表（可引用 tokens） */
  css?: string;
}

/** 插件宿主运行指标（用于向用户展示性能数据） */
export interface HostMetrics {
  total: number;
  enabled: number;
  activated: number;
  failed: number;
  /** 最近一次批量激活耗时（毫秒） */
  lastActivationMs: number;
}

export interface HostChangeEvent {
  type: 'install' | 'uninstall' | 'toggle' | 'ready' | 'activation';
  pluginId?: string;
}
