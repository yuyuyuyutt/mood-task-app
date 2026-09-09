// src/plugins/runtime/storage.ts
import type { PluginManifest } from '../parser/types';
import { PLUGINS_FILE, STORAGE_KEY, type InstalledPlugin, type PluginSource } from './types';

interface PersistedRecord {
  manifest: PluginManifest;
  enabled: boolean;
  installedAt: string;
  source: PluginSource;
}

interface PersistedState {
  version: 1;
  plugins: PersistedRecord[];
}

/** 检测是否运行在 Tauri 环境（浏览器开发模式下走 localStorage） */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function toRecord(p: InstalledPlugin): PersistedRecord {
  return {
    manifest: p.manifest,
    enabled: p.enabled,
    installedAt: p.installedAt,
    source: p.source,
  };
}

function toInstalled(rec: PersistedRecord): InstalledPlugin {
  const m = rec.manifest;
  return {
    id: m.metadata.id,
    name: m.metadata.name,
    version: m.metadata.version,
    author: m.metadata.author,
    description: m.metadata.description,
    manifest: m,
    enabled: rec.enabled,
    installedAt: rec.installedAt,
    source: rec.source ?? 'file',
  };
}

/**
 * 插件注册表存储。
 * - localStorage：同步镜像。浏览器开发 / 首帧主题恢复都依赖它（零延迟）。
 * - Tauri AppData 文件：持久化真源（异步）。存在时优先，并回写镜像。
 * 写入在调用方做防抖（见 PluginRegistry.persist）。
 */
export class PluginStorage {
  /** 同步读取（仅 localStorage 镜像；Tauri 下首次为空的，由 load() 异步补齐） */
  loadSync(): InstalledPlugin[] {
    return this.parse(localStorage.getItem(STORAGE_KEY));
  }

  /** 异步读取：Tauri 文件优先，否则回退镜像 */
  async load(): Promise<InstalledPlugin[]> {
    if (isTauri()) {
      try {
        const { readTextFile, exists, BaseDirectory } = await import('@tauri-apps/plugin-fs');
        if (await exists(PLUGINS_FILE, { baseDir: BaseDirectory.AppData })) {
          const content = await readTextFile(PLUGINS_FILE, { baseDir: BaseDirectory.AppData });
          const list = this.parse(content);
          if (list.length > 0) {
            // 回写同步镜像，保证后续 loadSync 一致
            localStorage.setItem(STORAGE_KEY, this.serialize(list));
            return list;
          }
        }
      } catch (err) {
        console.warn('[plugin-storage] Tauri fs read failed, falling back to localStorage:', err);
      }
    }
    return this.loadSync();
  }

  /** 持久化：总是写同步镜像；Tauri 环境下异步写文件（fire-and-forget） */
  async save(plugins: InstalledPlugin[]): Promise<void> {
    const json = this.serialize(plugins);
    try {
      localStorage.setItem(STORAGE_KEY, json);
    } catch {
      // localStorage 满等极端情况忽略（文件为真源）
    }
    if (isTauri()) {
      try {
        const { writeTextFile, mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs');
        await mkdir('plugins', { baseDir: BaseDirectory.AppData, recursive: true });
        await writeTextFile(PLUGINS_FILE, json, { baseDir: BaseDirectory.AppData });
      } catch (err) {
        console.warn('[plugin-storage] Tauri fs write failed (mirror kept):', err);
      }
    }
  }

  private parse(raw: string | null): InstalledPlugin[] {
    if (!raw) return [];
    try {
      const state = JSON.parse(raw) as PersistedState;
      if (!state || state.version !== 1 || !Array.isArray(state.plugins)) return [];
      const out: InstalledPlugin[] = [];
      for (const rec of state.plugins) {
        if (rec?.manifest?.metadata?.id) out.push(toInstalled(rec));
      }
      return out;
    } catch {
      return [];
    }
  }

  private serialize(plugins: InstalledPlugin[]): string {
    const state: PersistedState = { version: 1, plugins: plugins.map(toRecord) };
    return JSON.stringify(state);
  }
}
