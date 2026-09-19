// src/plugins/runtime/__tests__/dataStore.test.ts
// 数据权限门测试：这块是插件隔离的安全咽喉，此前零覆盖。
// 运行环境为 node（无 window），PluginDataStore 会走 localStorage 分支，
// 因此这里注入一个内存版 Storage 桩。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginDataStore } from '../dataStore';
import type { PluginManifest } from '../../parser/types';

class MemoryStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** 构造一个只声明了 mood/entries 读写的插件清单 */
function moodManifest(capabilityOverrides: Record<string, unknown> = {}): PluginManifest {
  return {
    metadata: { id: 'mood-diary', name: '心情日记' },
    capabilities: {
      data: {
        namespace: 'mood',
        collections: ['entries'],
        operations: ['read', 'write'],
      },
      ...capabilityOverrides,
    },
  } as unknown as PluginManifest;
}

function makeStore(manifests: Record<string, PluginManifest>) {
  return new PluginDataStore((id) => manifests[id]);
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PluginDataStore 权限门', () => {
  it('未声明 data 能力的插件一律拒绝访问', async () => {
    const store = makeStore({ 'no-data': { metadata: { id: 'no-data' } } as unknown as PluginManifest });
    await expect(store.list('no-data', 'mood', 'entries')).rejects.toThrow(/未声明 data 能力/);
  });

  it('已卸载（查不到清单）的插件拒绝访问', async () => {
    const store = makeStore({});
    await expect(store.get('ghost', 'mood', 'entries', '2026-09-14')).rejects.toThrow(/未声明 data 能力/);
  });

  it('跨命名空间访问被拒绝', async () => {
    const store = makeStore({ 'mood-diary': moodManifest() });
    await expect(store.list('mood-diary', 'others', 'entries')).rejects.toThrow(/试图访问 namespace/);
  });

  it('未声明的操作被拒绝（只声明 read/write 时不能 delete）', async () => {
    const store = makeStore({ 'mood-diary': moodManifest() });
    await expect(store.remove('mood-diary', 'mood', 'entries', 'k')).rejects.toThrow(/没有 "delete" 权限/);
  });

  it('未声明的集合被拒绝', async () => {
    const store = makeStore({ 'mood-diary': moodManifest() });
    await expect(store.list('mood-diary', 'mood', 'secrets')).rejects.toThrow(/无权访问集合/);
  });

  it('授权范围内的读写正常，且能读回写入值', async () => {
    const store = makeStore({
      'mood-diary': moodManifest({
        data: {
          namespace: 'mood',
          collections: ['entries'],
          operations: ['read', 'write', 'delete'],
        },
      }),
    });
    await store.put('mood-diary', 'mood', 'entries', '2026-09-14', { mood_score: 5 });

    const records = await store.list('mood-diary', 'mood', 'entries');
    expect(records).toHaveLength(1);
    expect(records[0].key).toBe('2026-09-14');
    expect(records[0].value).toEqual({ mood_score: 5 });

    await store.remove('mood-diary', 'mood', 'entries', '2026-09-14');
    expect(await store.list('mood-diary', 'mood', 'entries')).toHaveLength(0);
  });

  it('bind() 用插件自己的命名空间，且卸载后立即失效', async () => {
    const manifests: Record<string, PluginManifest> = { 'mood-diary': moodManifest() };
    const store = makeStore(manifests);
    const access = store.bind('mood-diary');

    await access.put('entries', '2026-09-14', { mood_score: 3 });
    expect((await access.list('entries'))[0].value).toEqual({ mood_score: 3 });

    delete manifests['mood-diary'];
    await expect(access.list('entries')).rejects.toThrow(/已卸载/);
  });

  it('core 身份拥有全命名空间读写权限（应用自身的数据不受插件白名单限制）', async () => {
    const store = makeStore({});
    await store.put('core', '__schedule', '2026-09-14', 'item-1', { title: '晨跑', start: '07:00' });
    const records = await store.list('core', '__schedule', '2026-09-14');
    expect(records[0].value).toEqual({ title: '晨跑', start: '07:00' });
  });
});

describe('PluginDataStore 备份能力', () => {
  it('dumpAll 扁平导出全部命名空间，restoreRows 可原样写回', async () => {
    const store = makeStore({ 'mood-diary': moodManifest() });
    await store.put('mood-diary', 'mood', 'entries', '2026-09-13', { mood_score: 4 });
    await store.put('core', '__schedule', '2026-09-14', 'a', { title: 'x', start: '09:00' });

    const dump = await store.dumpAll();
    expect(dump).toHaveLength(2);
    expect(dump.map((row) => `${row.namespace}/${row.collection}/${row.key}`).sort()).toEqual([
      '__schedule/2026-09-14/a',
      'mood/entries/2026-09-13',
    ]);

    // 清空后写回，数据应完全恢复
    await store.clearNamespace('mood');
    await store.clearNamespace('__schedule');
    expect(await store.dumpAll()).toHaveLength(0);

    expect(await store.restoreRows(dump)).toBe(2);
    const restored = await store.dumpAll();
    expect(restored).toHaveLength(2);
  });
});
