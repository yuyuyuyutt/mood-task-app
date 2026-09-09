// src/plugins/runtime/context.tsx
// 插件宿主的 React 接入层：Provider 在启动时同步恢复本地镜像（首帧无主题闪烁），
// 随后异步对齐 Tauri 文件；对外暴露稳定的、可被 memo 复用的操作函数，
// 以及由插件能力驱动的页面列表 / 回收站 / 数据访问。
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { getBuiltinToml } from '../builtin';
import { PluginParser, type ParseResult, type PluginManifest } from '../parser';
import { PluginDataStore, type PluginDataAccess } from './dataStore';
import { PluginHost } from './host';
import { PluginRegistry } from './registry';
import {
  CORE_VERSION,
  type HostMetrics,
  type InstalledPlugin,
  type PluginPageInfo,
  type PluginSource,
  type ThemeMode,
  type Tombstone,
} from './types';

/** 内置深色主题插件的固定 id（与 dark-theme.toml 中的 [metadata] id 一致） */
export const DARK_THEME_PLUGIN_ID = 'dark-theme';

export interface InstallResult {
  ok: boolean;
  plugin?: InstalledPlugin;
  errors: string[];
  warnings: string[];
}

export interface PluginHostContextValue {
  /** 异步存储（Tauri 文件）是否已对齐 */
  ready: boolean;
  /** 已安装插件（按安装顺序） */
  plugins: InstalledPlugin[];
  /** 由启用的页面能力插件贡献的页面（导航/路由用） */
  pages: PluginPageInfo[];
  /** 回收站：卸载后仍在保留期的插件数据 */
  tombstones: Tombstone[];
  metrics: HostMetrics;
  coreVersion: string;
  theme: {
    mode: ThemeMode;
    isDark: boolean;
    isLight: boolean;
    activePluginId: string | null;
    /** 切换深/浅：未安装深色主题插件时自动安装内置插件 */
    toggle: () => Promise<void>;
    setDark: () => Promise<void>;
    setLight: () => Promise<void>;
  };
  /** 命名空间隔离的长期数据存储（core 身份可读任何已授权命名空间） */
  dataStore: PluginDataStore;
  installFromManifest: (manifest: PluginManifest, source?: PluginSource) => Promise<InstallResult>;
  /** 直接解析 TOML 文本并安装（内置插件一键安装走这里；解析在空闲时执行） */
  installFromToml: (tomlText: string, source?: PluginSource) => Promise<InstallResult>;
  uninstall: (id: string) => Promise<void>;
  /** 回收站：立即清除某插件的保留数据 */
  purgePluginData: (id: string) => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  getPlugin: (id: string) => InstalledPlugin | undefined;
  isEnabled: (id: string) => boolean;
  /** 空闲时段解析 TOML（供安装弹窗使用，避免解析大文件时卡住 UI） */
  parseToml: (text: string) => Promise<ParseResult>;
}

const PluginHostContext = createContext<PluginHostContextValue | null>(null);

export function PluginHostProvider({ children }: { children: React.ReactNode }) {
  // 宿主只创建一次：同步载入本地镜像并进入空闲激活，保证首帧即可反映插件状态
  const runtimeRef = useRef<{ registry: PluginRegistry; host: PluginHost } | null>(null);
  if (runtimeRef.current == null) {
    const registry = new PluginRegistry();
    const host = new PluginHost(registry);
    registry.loadSync();
    host.scheduleActivation();
    runtimeRef.current = { registry, host };
  }
  const { registry, host } = runtimeRef.current;

  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let mounted = true;
    const bump = () => {
      if (mounted) setTick((t) => t + 1);
    };
    // 注册表变更（立即刷新列表状态）+ 宿主激活（刷新指标/主题状态）
    const unsubRegistry = registry.subscribe(bump);
    const unsubHost = host.subscribe(bump);
    void host.init().then(() => {
      if (mounted) setReady(true);
    });
    return () => {
      mounted = false;
      unsubRegistry();
      unsubHost();
    };
  }, [registry, host]);

  // ---- 稳定的操作函数（依赖均为 ref 常量，跨 tick 保持引用，memo 友好） ----

  const getPlugin = useCallback((id: string) => registry.get(id), [registry]);
  const isEnabled = useCallback((id: string) => registry.isEnabled(id), [registry]);
  const dataStore = host.getDataStore();

  const installFromManifest = useCallback(
    async (manifest: PluginManifest, source: PluginSource = 'file'): Promise<InstallResult> => {
      try {
        const plugin = await host.installPlugin(manifest, source);
        return { ok: true, plugin, errors: [], warnings: [] };
      } catch (err) {
        return { ok: false, errors: [err instanceof Error ? err.message : String(err)], warnings: [] };
      }
    },
    [host],
  );

  const parseToml = useCallback((text: string): Promise<ParseResult> => {
    const parser = new PluginParser();
    return new Promise((resolve) => {
      // 解析放到空闲回调：大清单解析不阻塞用户交互
      const run = () => resolve(parser.parse(text));
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(run, { timeout: 500 });
      } else {
        window.setTimeout(run, 0);
      }
    });
  }, []);

  const installFromToml = useCallback(
    async (tomlText: string, source: PluginSource = 'file'): Promise<InstallResult> => {
      const result = await parseToml(tomlText);
      if (!result.success || !result.manifest) {
        return {
          ok: false,
          errors: result.errors.map((e) => e.message),
          warnings: result.warnings.map((w) => w.message),
        };
      }
      return installFromManifest(result.manifest, source);
    },
    [parseToml, installFromManifest],
  );

  const uninstall = useCallback(
    async (id: string) => {
      await host.uninstallPlugin(id);
    },
    [host],
  );

  const purgePluginData = useCallback(
    async (id: string) => {
      await host.purgeNow(id);
    },
    [host],
  );

  const setEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      await registry.setEnabled(id, enabled);
      host.flush(); // 用户主动开关：立即生效（如禁用深色插件后马上回到浅色）
    },
    [registry, host],
  );

  // ---- 主题 API：完全由主题能力插件驱动 ----

  const ensureDarkPlugin = useCallback(async (): Promise<boolean> => {
    if (registry.get(DARK_THEME_PLUGIN_ID)) return true;
    const toml = getBuiltinToml(DARK_THEME_PLUGIN_ID);
    if (!toml) return false;
    const res = await installFromToml(toml, 'builtin');
    return res.ok;
  }, [registry, installFromToml]);

  const theme = useMemo(
    () => {
      const state = host.getThemeState();
      const isDark = state.mode === 'dark';
      const setDark = async () => {
        if (await ensureDarkPlugin()) {
          await setEnabled(DARK_THEME_PLUGIN_ID, true);
        }
      };
      const setLight = async () => {
        if (registry.get(DARK_THEME_PLUGIN_ID)) {
          await setEnabled(DARK_THEME_PLUGIN_ID, false);
        }
      };
      const toggle = async () => {
        if (host.getThemeState().mode === 'dark') await setLight();
        else await setDark();
      };
      return {
        mode: state.mode,
        isDark,
        isLight: !isDark,
        activePluginId: state.activePluginId,
        toggle,
        setDark,
        setLight,
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick, ready, ensureDarkPlugin, setEnabled, registry, host],
  );

  const value = useMemo<PluginHostContextValue>(() => {
    const plugins = registry.snapshot();
    const pages: PluginPageInfo[] = plugins
      .filter((p) => p.enabled && p.manifest.capabilities?.page)
      .map((p) => {
        const cap = p.manifest.capabilities!.page!;
        return {
          pluginId: p.id,
          pageId: cap.pageId,
          path: cap.path,
          title: cap.title,
          icon: cap.icon,
          showInNav: cap.showInNav !== false,
        };
      });
    return {
      ready,
      plugins,
      pages,
      tombstones: host.getTombstones(),
      metrics: host.getMetrics(),
      coreVersion: CORE_VERSION,
      theme,
      dataStore,
      installFromManifest,
      installFromToml,
      uninstall,
      purgePluginData,
      setEnabled,
      getPlugin,
      isEnabled,
      parseToml,
    };
  }, [ready, tick, theme, dataStore, installFromManifest, installFromToml, uninstall, purgePluginData, setEnabled, getPlugin, isEnabled, parseToml, registry, host]);

  return <PluginHostContext.Provider value={value}>{children}</PluginHostContext.Provider>;
}

export function usePluginHost(): PluginHostContextValue {
  const ctx = useContext(PluginHostContext);
  if (!ctx) {
    throw new Error('usePluginHost must be used within <PluginHostProvider>');
  }
  return ctx;
}

/**
 * 页面组件获取指定插件的命名空间数据访问句柄。
 * 权限在每次调用时按该插件声明的 data 能力实时校验。
 */
export function usePluginData(pluginId: string): PluginDataAccess {
  const ctx = usePluginHost();
  return useMemo(() => ctx.dataStore.bind(pluginId), [ctx.dataStore, pluginId]);
}
