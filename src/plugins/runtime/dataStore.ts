// src/plugins/runtime/dataStore.ts
// 插件长期数据存储：按 namespace 隔离的键值数据 + 卸载保留期管理。
// 安全模型（在 store 内强制，与调用方无关）：
// - 身份 identity：插件 id 或 'core'（受信任的核心宿主）。
// - 插件只能访问【自己声明的 data 能力】中的 namespace / collections / operations；
// - core 拥有全部读写删权限（它拥有应用本身），但 UI 层只在插件启用时读取；
// - 未知/未声明的命名空间、越权操作一律拒绝（抛错，绝不静默放行）。
// 保留期：卸载 -> tombstone（数据不动）；保留期内重装 -> 自动恢复；到期 -> 清除。
// 存储后端：Tauri 下走 SQLite（plugin_data 表）；浏览器开发走 localStorage。
import type { DataCapability, PluginManifest } from '../parser/types';
import type { DataOp, DataRecord, Tombstone } from './types';

/** localStorage 数据键前缀 */
const DATA_PREFIX = 'mood-task:plugin-data:v1';
/** tombstone 存储键 */
const TOMBSTONE_KEY = 'mood-task:plugin-tombstones:v1';

export type DataIdentity = string;

/** 宿主给页面/核心提供的绑定式数据访问（页面用 usePluginData 获取） */
export interface PluginDataAccess {
  list: (collection: string) => Promise<DataRecord[]>;
  get: (collection: string, key: string) => Promise<unknown>;
  put: (collection: string, key: string, value: unknown) => Promise<void>;
  remove: (collection: string, key: string) => Promise<void>;
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function dataKey(namespace: string, collection: string, key: string): string {
  return `${DATA_PREFIX}:${namespace}:${collection}:${key}`;
}

function listPrefix(namespace: string, collection: string): string {
  return `${DATA_PREFIX}:${namespace}:${collection}:`;
}

export class PluginDataStore {
  /** identity -> 清单查询（插件注册表提供）；插件被卸载后返回 undefined */
  constructor(private getManifest: (pluginId: string) => PluginManifest | undefined) {}

  // ---------------- 权限门 ----------------

  /**
   * 校验并返回授权信息。
   * 返回 'core' 表示受信任核心（完全授权）；返回 DataCapability 表示插件授权。
   * 任何不满足条件的情况抛错。
   */
  private authorize(
    identity: DataIdentity,
    namespace: string,
    collection: string,
    op: DataOp,
  ): 'core' | DataCapability {
    if (identity === 'core') return 'core';
    const manifest = this.getManifest(identity);
    const cap = manifest?.capabilities?.data;
    if (!cap) {
      throw new Error(`[data-store] 插件 "${identity}" 未声明 data 能力，禁止数据访问`);
    }
    if (cap.namespace !== namespace) {
      throw new Error(
        `[data-store] 插件 "${identity}" 试图访问 namespace "${namespace}"，但其声明的隔离域是 "${cap.namespace}"（已拒绝）`,
      );
    }
    if (!cap.operations?.includes(op)) {
      throw new Error(`[data-store] 插件 "${identity}" 没有 "${op}" 权限（已拒绝）`);
    }
    if (!cap.collections?.includes(collection)) {
      throw new Error(`[data-store] 插件 "${identity}" 无权访问集合 "${collection}"（已拒绝）`);
    }
    return cap;
  }

  // ---------------- 数据读写 ----------------

  async list(identity: DataIdentity, namespace: string, collection: string): Promise<DataRecord[]> {
    this.authorize(identity, namespace, collection, 'read');
    if (isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      const rows = (await invoke('plugin_data_list', { namespace, collection })) as Array<{
        key: string;
        value: string;
        updated_at: string;
      }>;
      return rows.map((r) => ({ key: r.key, value: JSON.parse(r.value), updatedAt: r.updated_at }));
    }
    return this.listLocal(namespace, collection);
  }

  async get(identity: DataIdentity, namespace: string, collection: string, key: string): Promise<unknown> {
    this.authorize(identity, namespace, collection, 'read');
    if (isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      const row = (await invoke('plugin_data_get', { namespace, collection, key })) as
        | { value: string; updated_at: string }
        | null;
      return row ? JSON.parse(row.value) : null;
    }
    const raw = localStorage.getItem(dataKey(namespace, collection, key));
    return raw ? JSON.parse(raw) : null;
  }

  async put(identity: DataIdentity, namespace: string, collection: string, key: string, value: unknown): Promise<void> {
    this.authorize(identity, namespace, collection, 'write');
    const json = JSON.stringify(value);
    if (isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('plugin_data_put', { namespace, collection, key, value: json });
      return;
    }
    localStorage.setItem(dataKey(namespace, collection, key), json);
  }

  async remove(identity: DataIdentity, namespace: string, collection: string, key: string): Promise<void> {
    this.authorize(identity, namespace, collection, 'delete');
    if (isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('plugin_data_delete', { namespace, collection, key });
      return;
    }
    localStorage.removeItem(dataKey(namespace, collection, key));
  }

  async clear(identity: DataIdentity, namespace: string, collection: string): Promise<void> {
    this.authorize(identity, namespace, collection, 'delete');
    if (isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('plugin_data_clear', { namespace, collection });
      return;
    }
    const prefix = listPrefix(namespace, collection);
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) toRemove.push(k);
    }
    for (const k of toRemove) localStorage.removeItem(k);
  }

  /** 清除整个命名空间的数据（仅供保留期到期/回收站清除使用；core 身份） */
  async clearNamespace(namespace: string): Promise<void> {
    if (isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('plugin_data_clear_namespace', { namespace });
      return;
    }
    const prefix = `${DATA_PREFIX}:${namespace}:`;
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) toRemove.push(k);
    }
    for (const k of toRemove) localStorage.removeItem(k);
  }

  /** 绑定某个插件的访问句柄（页面组件用；权限/命名空间在每次调用时实时校验） */
  bind(pluginId: string): PluginDataAccess {
    const resolve = (): DataCapability => {
      const cap = this.getManifest(pluginId)?.capabilities?.data;
      if (!cap) {
        throw new Error(`[data-store] 插件 "${pluginId}" 未声明 data 能力或已卸载，数据不可用`);
      }
      return cap;
    };
    return {
      list: (c) => this.list(pluginId, resolve().namespace, c),
      get: (c, k) => this.get(pluginId, resolve().namespace, c, k),
      put: (c, k, v) => this.put(pluginId, resolve().namespace, c, k, v),
      remove: (c, k) => this.remove(pluginId, resolve().namespace, c, k),
    };
  }

  private listLocal(namespace: string, collection: string): DataRecord[] {
    const prefix = listPrefix(namespace, collection);
    const out: DataRecord[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) {
        const raw = localStorage.getItem(k);
        if (raw != null) {
          out.push({ key: k.slice(prefix.length), value: JSON.parse(raw), updatedAt: new Date().toISOString() });
        }
      }
    }
    return out;
  }

  // ---------------- 保留期（tombstone） ----------------

  private readTombstones(): Record<string, Tombstone> {
    try {
      const raw = localStorage.getItem(TOMBSTONE_KEY);
      return raw ? (JSON.parse(raw) as Record<string, Tombstone>) : {};
    } catch {
      return {};
    }
  }

  private writeTombstones(map: Record<string, Tombstone>): void {
    localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(map));
  }

  /** 卸载：写入墓碑，数据不动 */
  tombstone(pluginId: string, retentionDays: number, pluginName: string, namespace?: string): void {
    const map = this.readTombstones();
    map[pluginId] = {
      pluginId,
      uninstalledAt: Date.now(),
      retentionDays,
      pluginName,
      namespace,
    };
    this.writeTombstones(map);
  }

  /** 保留期内重新安装：移除墓碑，数据恢复可见 */
  restore(pluginId: string): void {
    const map = this.readTombstones();
    if (map[pluginId]) {
      delete map[pluginId];
      this.writeTombstones(map);
    }
  }

  hasTombstone(pluginId: string): boolean {
    return !!this.readTombstones()[pluginId];
  }

  getTombstones(): Tombstone[] {
    return Object.values(this.readTombstones());
  }

  /** 清理已过保留期的数据；返回清除的命名空间数量 */
  async purgeExpired(): Promise<number> {
    const map = this.readTombstones();
    const now = Date.now();
    let purged = 0;
    for (const [id, t] of Object.entries(map)) {
      const expiresAt = t.uninstalledAt + t.retentionDays * 86_400_000;
      if (now >= expiresAt) {
        if (t.namespace) {
          try {
            await this.clearNamespace(t.namespace);
            purged++;
          } catch (err) {
            console.warn(`[data-store] 清除 ${id} 数据失败:`, err);
          }
        }
        delete map[id];
      }
    }
    this.writeTombstones(map);
    return purged;
  }

  /** 立即清除某个插件的全部保留数据（回收站"立即清除"） */
  async purgeNow(pluginId: string): Promise<void> {
    const map = this.readTombstones();
    const t = map[pluginId];
    if (!t) return;
    if (t.namespace) {
      try {
        await this.clearNamespace(t.namespace);
      } catch (err) {
        console.warn(`[data-store] 清除 ${pluginId} 数据失败:`, err);
      }
    }
    delete map[pluginId];
    this.writeTombstones(map);
  }
}
