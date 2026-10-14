// src/utils/__tests__/storageKeys.test.ts
// 品牌更名的旧数据兼容层：迁移必须"搬过去、不覆盖、只做一次"。
// 这三条任意一条错了，用户要么丢数据，要么看到旧数据把新数据顶掉。
import { describe, expect, it } from 'vitest';
import {
  LEGACY_STORAGE_PREFIX,
  STORAGE_PREFIX,
  migrateLegacyLocalStorage,
  toCurrentKey,
} from '../storageKeys';

/** 最小 localStorage 桩：node 环境没有 Web Storage */
function createStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  const stub = {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
  return stub as unknown as Storage;
}

describe('toCurrentKey', () => {
  it('把旧前缀换成新前缀', () => {
    expect(toCurrentKey('mood-task:plugins:v1')).toBe('sophotask:plugins:v1');
  });

  it('带冒号的复合键逐段保留', () => {
    expect(toCurrentKey('mood-task:plugin-data:v1:mood:entries:2026-10-14')).toBe(
      'sophotask:plugin-data:v1:mood:entries:2026-10-14',
    );
  });

  it('非旧前缀的键原样返回', () => {
    expect(toCurrentKey('sophotask:plugins:v1')).toBe('sophotask:plugins:v1');
    expect(toCurrentKey('other:key')).toBe('other:key');
  });
});

describe('migrateLegacyLocalStorage', () => {
  it('把旧键搬到新键并删除旧键', () => {
    const storage = createStorage({
      'mood-task:plugins:v1': '{"version":1,"plugins":[]}',
      'mood-task:app-settings:v1': '{"language":"zh-CN"}',
      unrelated: 'keep',
    });

    expect(migrateLegacyLocalStorage(storage)).toBe(2);
    expect(storage.getItem('sophotask:plugins:v1')).toBe('{"version":1,"plugins":[]}');
    expect(storage.getItem('sophotask:app-settings:v1')).toBe('{"language":"zh-CN"}');
    expect(storage.getItem('mood-task:plugins:v1')).toBeNull();
    expect(storage.getItem('unrelated')).toBe('keep');
  });

  it('新键已存在时保留新键，只删旧键（不能把用户改名后的新数据回退）', () => {
    const storage = createStorage({
      'mood-task:plugins:v1': 'old-value',
      'sophotask:plugins:v1': 'new-value',
    });

    expect(migrateLegacyLocalStorage(storage)).toBe(0);
    expect(storage.getItem('sophotask:plugins:v1')).toBe('new-value');
    expect(storage.getItem('mood-task:plugins:v1')).toBeNull();
  });

  it('幂等：第一次搬迁、第二次无事可做', () => {
    const storage = createStorage({ 'mood-task:theme:preference': 'dark' });

    expect(migrateLegacyLocalStorage(storage)).toBe(1);
    expect(storage.getItem('sophotask:theme:preference')).toBe('dark');
    expect(migrateLegacyLocalStorage(storage)).toBe(0);
    expect(storage.getItem('sophotask:theme:preference')).toBe('dark');
  });

  it('没有旧键时返回 0，且不动任何无关键', () => {
    const storage = createStorage({ 'sophotask:plugins:v1': 'x' });
    expect(migrateLegacyLocalStorage(storage)).toBe(0);
    expect(storage.getItem('sophotask:plugins:v1')).toBe('x');
  });

  it('前缀常量本身是稳定的（迁移目标即业务读取的键）', () => {
    expect(STORAGE_PREFIX).toBe('sophotask:');
    expect(LEGACY_STORAGE_PREFIX).toBe('mood-task:');
  });
});
