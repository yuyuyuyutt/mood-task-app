// src/plugins/runtime/registry.ts
// 插件注册表：内存 Map + 防抖持久化。
// 性能要点：
// - 查找 O(1)；快照保持对象引用稳定（仅被修改的插件换新对象），
//   使 React.memo 行组件在无关变更时零重渲染。
// - 写盘 150ms 防抖：批量切换/安装时只落盘一次。
import type { PluginManifest } from '../parser/types';
import { PluginStorage } from './storage';
import type { HostChangeEvent, InstalledPlugin, PluginSource } from './types';

type RegistryListener = (event: HostChangeEvent) => void;

export class PluginRegistry {
  private byId = new Map<string, InstalledPlugin>();
  private order: string[] = [];
  private storage: PluginStorage;
  private listeners = new Set<RegistryListener>();
  private saveTimer: number | null = null;

  constructor(storage: PluginStorage = new PluginStorage()) {
    this.storage = storage;
  }

  /** 同步载入本地镜像（浏览器路径：首帧即可获得主题状态，无闪烁） */
  loadSync(): void {
    const list = this.storage.loadSync();
    if (list.length === 0) return;
    this.byId.clear();
    this.order = [];
    for (const plugin of list) this.upsert(plugin);
  }

  /** 异步初始化：Tauri 环境下以 AppData 文件为准补齐 */
  async init(): Promise<void> {
    if (this.order.length === 0) this.loadSync();
    const remote = await this.storage.load();
    if (remote.length > 0) {
      this.byId.clear();
      this.order = [];
      for (const plugin of remote) this.upsert(plugin);
    }
    this.emit({ type: 'ready' });
  }

  /** 安装顺序的稳定快照（对象引用稳定） */
  snapshot(): InstalledPlugin[] {
    return this.order.map((id) => this.byId.get(id)!);
  }

  get(id: string): InstalledPlugin | undefined {
    return this.byId.get(id);
  }

  isEnabled(id: string): boolean {
    return this.byId.get(id)?.enabled ?? false;
  }

  async install(manifest: PluginManifest, source: PluginSource): Promise<InstalledPlugin> {
    const id = manifest.metadata.id;
    const existing = this.byId.get(id);
    const plugin: InstalledPlugin = {
      id,
      name: manifest.metadata.name,
      version: manifest.metadata.version,
      author: manifest.metadata.author,
      description: manifest.metadata.description,
      manifest,
      // 覆盖安装保留原启用状态；全新安装默认启用
      enabled: existing ? existing.enabled : true,
      installedAt: existing?.installedAt ?? new Date().toISOString().slice(0, 10),
      source: existing?.source ?? source,
    };
    this.upsert(plugin);
    this.emit({ type: 'install', pluginId: id });
    await this.persist();
    return plugin;
  }

  async uninstall(id: string): Promise<void> {
    if (!this.byId.delete(id)) return;
    this.order = this.order.filter((x) => x !== id);
    this.emit({ type: 'uninstall', pluginId: id });
    await this.persist();
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const existing = this.byId.get(id);
    if (!existing || existing.enabled === enabled) return;
    // 不可变更新：仅被修改的插件获得新引用，其余保持稳定（memo 友好）
    this.byId.set(id, { ...existing, enabled });
    this.emit({ type: 'toggle', pluginId: id });
    await this.persist();
  }

  subscribe(fn: RegistryListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private upsert(plugin: InstalledPlugin): void {
    if (!this.byId.has(plugin.id)) this.order.push(plugin.id);
    this.byId.set(plugin.id, plugin);
  }

  private emit(event: HostChangeEvent): void {
    for (const fn of this.listeners) fn(event);
  }

  private persist(): Promise<void> {
    // 防抖：连续操作只写一次；返回 promise 使调用方可 await 完成
    if (this.saveTimer != null) return Promise.resolve();
    return new Promise((resolve) => {
      this.saveTimer = window.setTimeout(() => {
        this.saveTimer = null;
        void this.storage.save(this.snapshot()).finally(resolve);
      }, 150);
    });
  }
}
