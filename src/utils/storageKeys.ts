// src/utils/storageKeys.ts
// 品牌更名（mood-task-app → sophotask）后的存储标识常量，以及**旧键兼容层**。
//
// 约定：localStorage 键统一为 `<品牌前缀>:<domain>:v1`。
// 更名前写入的数据仍以 `mood-task:` 开头，不能直接丢弃，因此在应用启动时做一次性迁移
// （见 migrateLegacyLocalStorage），运行时只认新前缀。
//
// 为什么用"启动时整体搬迁"而不是"每次读取双键回退"：
// 插件数据与墓碑表都要**按键前缀枚举**（`storage.key(i)`），
// 双前缀回退会让每个枚举点都要写两份逻辑，反而更容易漏；先搬迁再统一，枚举点无需改动。

/** 当前品牌前缀 */
export const STORAGE_PREFIX = 'sophotask:';

/** 更名前的旧前缀（只在迁移时使用，业务代码不应直接引用） */
export const LEGACY_STORAGE_PREFIX = 'mood-task:';

/** 旧键 → 新键；不是旧前缀的键原样返回 */
export function toCurrentKey(key: string): string {
  return key.startsWith(LEGACY_STORAGE_PREFIX)
    ? STORAGE_PREFIX + key.slice(LEGACY_STORAGE_PREFIX.length)
    : key;
}

/**
 * 把 `mood-task:*` 一次性搬到 `sophotask:*`。
 *
 * 规则：
 * - **新键已存在时保留新键**（旧值只删不写），避免把用户更名后的新数据回退成旧数据；
 * - 旧键一律删除，迁移只会成功执行一次，不会反复覆盖；
 * - 返回真正写入的键数量，便于日志与测试断言。
 */
export function migrateLegacyLocalStorage(storage: Storage): number {
  // 先收集键名再改动：边遍历边删除会让 storage.key(i) 的索引错位
  const legacyKeys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && key.startsWith(LEGACY_STORAGE_PREFIX)) legacyKeys.push(key);
  }

  let migrated = 0;
  for (const oldKey of legacyKeys) {
    const value = storage.getItem(oldKey);
    const newKey = toCurrentKey(oldKey);
    if (value !== null && storage.getItem(newKey) === null) {
      storage.setItem(newKey, value);
      migrated += 1;
    }
    storage.removeItem(oldKey);
  }
  return migrated;
}
