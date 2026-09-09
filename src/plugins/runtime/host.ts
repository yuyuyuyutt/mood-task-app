// src/plugins/runtime/host.ts
// 插件宿主：负责把"已启用的插件"批量解释为真实效果，并管理插件数据的生命周期。
// 性能设计（大量插件场景）：
// - 启动时只激活【已启用】的插件，且放在空闲回调里执行，不阻塞首屏；
// - 同帧内的多次注册表变更合并为一次批量激活（防抖）；
// - 每个插件的激活互相隔离（try/catch），单个插件崩溃不影响其他插件；
// - flush() 供用户主动操作时同步生效（如切换主题后立即看到结果）。
// 数据生命周期：
// - 卸载 -> 写入墓碑（tombstone），数据进入保留期（默认 3 天）不动；
// - 保留期内重新安装 -> 自动恢复数据；
// - 到期（或回收站"立即清除"）-> 按命名空间清除数据。
import { ThemeController } from './capabilities';
import { PluginDataStore } from './dataStore';
import { PluginRegistry } from './registry';
import { SandboxHost } from './sandbox';
import type {
  HostMetrics,
  InstalledPlugin,
  PluginSource,
  ThemeState,
  Tombstone,
} from './types';
import type { PluginManifest } from '../parser/types';

type HostListener = () => void;

/** 卸载数据保留的默认天数 */
export const DEFAULT_RETENTION_DAYS = 3;
/** 自动清理过期保留数据的周期（毫秒） */
const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 小时

export class PluginHost {
  private registry: PluginRegistry;
  private theme = new ThemeController();
  private dataStore: PluginDataStore;
  private sandbox: SandboxHost;
  private listeners = new Set<HostListener>();
  private activated = new Set<string>();
  private activationTimer: number | null = null;
  private purgeTimer: number | null = null;
  private metrics: HostMetrics = {
    total: 0,
    enabled: 0,
    activated: 0,
    failed: 0,
    lastActivationMs: 0,
  };

  constructor(registry: PluginRegistry) {
    this.registry = registry;
    // 数据权限门：以注册表实时清单为准（插件卸载后即失去数据访问权）
    this.dataStore = new PluginDataStore((id) => registry.get(id)?.manifest);
    // 沙箱代码插件：插件 JS 提交的主题规格 -> 落到真实 DOM
    this.sandbox = new SandboxHost({
      onThemeApply: (id, spec) => this.theme.applyDynamic(id, spec),
    });
    registry.subscribe(() => this.scheduleActivation());
  }

  getThemeState(): ThemeState {
    return this.theme.state;
  }

  getMetrics(): HostMetrics {
    return { ...this.metrics };
  }

  getDataStore(): PluginDataStore {
    return this.dataStore;
  }

  /** 主题状态变化订阅（宿主内部转发 ThemeController 的变更） */
  subscribe(fn: HostListener): () => void {
    this.listeners.add(fn);
    const unsubTheme = this.theme.subscribe(() => this.emit());
    return () => {
      this.listeners.delete(fn);
      unsubTheme();
    };
  }

  async init(): Promise<void> {
    this.registry.loadSync();
    await this.registry.init();
    // 清理已过保留期的数据（浏览器/本地存储；Tauri 下同样适用）
    try {
      const purged = await this.dataStore.purgeExpired();
      if (purged > 0) console.info(`[plugin-host] 已清除 ${purged} 个过期保留数据的命名空间`);
    } catch (err) {
      console.warn('[plugin-host] 清理过期保留数据失败:', err);
    }
    this.scheduleActivation();
    this.startPurgeTimer();
  }

  // ---------------- 插件生命周期（含数据保留） ----------------

  /** 安装：注册 + 若处于保留期内自动恢复历史数据 */
  async installPlugin(manifest: PluginManifest, source: PluginSource): Promise<InstalledPlugin> {
    const id = manifest.metadata.id;
    if (this.dataStore.hasTombstone(id)) {
      this.dataStore.restore(id); // 保留期内重装 -> 数据恢复可见
    }
    const plugin = await this.registry.install(manifest, source);
    this.flush();
    return plugin;
  }

  /** 卸载：先确定性移除该插件的能力（若它是当前主题插件，立即回到基线），
   *  再移除注册表记录 + 写入墓碑（数据保留 retentionDays 天） */
  async uninstallPlugin(id: string): Promise<void> {
    const plugin = this.registry.get(id);
    if (!plugin) return;
    try {
      // 1) 若卸载的是当前生效的主题插件：立即撤销其类名/样式，避免残留导致界面异常
      if (this.theme.state.activePluginId === id) {
        this.theme.clear();
        this.activated.delete(id);
      }
      // 沙箱代码插件：卸载其 iframe
      this.sandbox.unmount(id);
    } catch (err) {
      console.error(`[plugin-host] 卸载前撤销主题失败 "${id}":`, err);
    }
    const dataCap = plugin.manifest.capabilities?.data;
    if (dataCap) {
      this.dataStore.tombstone(
        id,
        dataCap.retentionDays ?? DEFAULT_RETENTION_DAYS,
        plugin.name,
        dataCap.namespace,
      );
    }
    try {
      await this.registry.uninstall(id);
    } finally {
      this.flush();
    }
  }

  /** 回收站：立即清除某个插件的保留数据（不恢复插件） */
  async purgeNow(id: string): Promise<void> {
    await this.dataStore.purgeNow(id);
    this.emit();
  }

  getTombstones(): Tombstone[] {
    return this.dataStore.getTombstones();
  }

  // ---------------- 激活 ----------------

  /** 取消待处理调度并立即激活（用户主动操作时调用，保证即时生效） */
  flush(): void {
    if (this.activationTimer != null) {
      if (typeof cancelIdleCallback === 'function') {
        cancelIdleCallback(this.activationTimer);
      } else {
        window.clearTimeout(this.activationTimer);
      }
      this.activationTimer = null;
    }
    this.activateAll();
  }

  /** 安排一次批量激活（空闲时段执行；同帧内多次调用自动合并）。公开供 Provider 启动时调用 */
  scheduleActivation(): void {
    if (this.activationTimer != null) return;
    const run = () => {
      this.activationTimer = null;
      this.activateAll();
    };
    if (typeof requestIdleCallback === 'function') {
      // 空闲执行，timeout 兜底：空闲被持续占用时最多延迟 300ms
      this.activationTimer = requestIdleCallback(run, { timeout: 300 });
    } else {
      this.activationTimer = window.setTimeout(run, 0);
    }
  }

  private activateAll(): void {
    const start = performance.now();
    const plugins = this.registry.snapshot();
    const enabled = new Set(plugins.filter((p) => p.enabled).map((p) => p.id));
    let activated = 0;
    let failed = 0;
    try {
      // 1) 停用已被卸载 / 被禁用的插件
      for (const id of this.activated) {
        if (!enabled.has(id)) {
          this.deactivate(id);
          this.activated.delete(id);
        }
      }

      // 2) 按安装顺序激活启用的插件（错误隔离）
      for (const plugin of plugins) {
        if (!plugin.enabled || this.activated.has(plugin.id)) continue;
        if (this.activate(plugin)) {
          activated++;
          this.activated.add(plugin.id);
        } else {
          failed++;
        }
      }

      // 3) 重建主题状态：以安装顺序最后一个启用的主题插件为准（幂等；
      //    解决"多个主题插件相互覆盖/停用后未回退"的边界情况）。
      //    若存在已启用的"代码主题插件"，则声明式主题让位——代码插件会
      //    在沙箱就绪后通过消息协议自行 applyDynamic（避免两个主题打架）。
      const hasCodeTheme = plugins.some(
        (p) => p.enabled && p.manifest.capabilities?.code?.kind === 'theme',
      );
      if (!hasCodeTheme) {
        const themePlugins = plugins.filter((p) => p.enabled && p.manifest.capabilities?.theme);
        const themePlugin = themePlugins.length > 0 ? themePlugins[themePlugins.length - 1] : undefined;
        if (themePlugin) {
          const cap = themePlugin.manifest.capabilities?.theme;
          if (cap) this.theme.apply(themePlugin.id, cap);
        } else if (this.theme.state.activePluginId != null) {
          this.theme.clear();
        }
      }
    } catch (err) {
      // 单次批量激活绝不向外抛：任何插件/主题异常都不应拖垮整个宿主
      console.error('[plugin-host] activateAll failed:', err);
    } finally {
      this.metrics = {
        total: plugins.length,
        enabled: enabled.size,
        activated: this.activated.size,
        failed,
        lastActivationMs: Math.round(performance.now() - start),
      };
      this.emit();
    }
  }

  /** 激活单个插件的能力；返回是否成功。任何异常在此被捕获隔离。 */
  private activate(plugin: InstalledPlugin): boolean {
    try {
      const caps = plugin.manifest.capabilities;
      if (caps?.theme) {
        // 多个主题插件时，安装顺序靠后的生效
        this.theme.apply(plugin.id, caps.theme);
      }
      // 代码能力（theme 类）：挂载沙箱 iframe 运行其源码；其主题通过消息协议应用
      const code = caps?.code;
      if (code?.kind === 'theme') {
        const source = code.inline ?? code.url ?? '';
        this.sandbox.mountTheme(plugin.id, source, typeof code.url === 'string');
      }
      // page / data 能力无需"激活"动作：页面由路由层按启用状态挂载，
      // 数据由 dataStore 在每次访问时实时校验权限。
      return true;
    } catch (err) {
      console.error(`[plugin-host] activate "${plugin.id}" failed:`, err);
      return false;
    }
  }

  /** 停用单个插件的能力 */
  private deactivate(id: string): void {
    try {
      if (this.theme.state.activePluginId === id) this.theme.clear();
      this.sandbox.unmount(id);
    } catch (err) {
      console.error(`[plugin-host] deactivate "${id}" failed:`, err);
    }
  }

  /** 定时清理过期保留数据（StrictMode 下防重复） */
  private startPurgeTimer(): void {
    if (this.purgeTimer != null) return;
    if (typeof window === 'undefined') return;
    this.purgeTimer = window.setInterval(() => {
      void this.dataStore.purgeExpired().then((n) => {
        if (n > 0) this.emit();
      });
    }, PURGE_INTERVAL_MS);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
