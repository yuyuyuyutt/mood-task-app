// src/features/plan-generator/db/plannerDB.ts
// 本地 IndexedDB 持久化层（隐私：数据只存在本机浏览器 IndexedDB，绝不上传）。
//
// 数据库结构（mood-task-planner, v1）：
// - store 'kv'     (keyPath: 'key') —— 个人画像、偏好、反馈等键值数据
// - store 'plans'  (keyPath: 'id')  —— 生成的计划（任务列表/事件时段表）
//
// 本文件只依赖浏览器原生 IndexedDB，无任何网络请求。
//
// 【加密扩展接口】当前版本不加密；将来如需本地加密，建议：
//   1) 新增模块 services/crypto.ts，提供 encrypt(value, key) / decrypt(cipher, key)；
//   2) 密钥经 WebCrypto 生成并存储于 IndexedDB（或系统钥匙串），
//   3) 在 kvSet/putPlan 写盘前加密 value，在读取后解密（保持本文件 API 不变）。
import type { GeneratedPlan, ManualResource } from '../types';

export const PLANNER_DB_NAME = 'mood-task-planner';
/** v2：新增 resources store（用户手动维护的资源库） */
export const PLANNER_DB_VERSION = 2;

export const KV_PROFILE = 'habitProfile';
export const KV_LLM_CONFIG = 'llmConfig';
export const KV_PLAN_PREFS = 'planPrefs';
/** 资源与联网设置（三层开关 / SearXNG 地址等） */
export const KV_NETWORKING = 'networkingSettings';
/** 用户点击资源的偏好统计：Record<source, count> */
export const KV_RESOURCE_CLICKS = 'resourceClicks';
/** 反馈键：feedback:<planId> */

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持 IndexedDB（请使用现代浏览器或 Tauri WebView）'));
      return;
    }
    const req = indexedDB.open(PLANNER_DB_NAME, PLANNER_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('plans')) {
        db.createObjectStore('plans', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('resources')) {
        db.createObjectStore('resources', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('打开 IndexedDB 失败'));
  });
  // 失败后允许下次重试
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function tx<T>(
  storeName: 'kv' | 'plans' | 'resources',
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(storeName, mode);
        const req = run(t.objectStore(storeName));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB 操作失败'));
      }),
  );
}

// ---------------- kv ----------------

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const rec = await tx<{ key: string; value: T } | undefined>('kv', 'readonly', (s) =>
    s.get(key) as IDBRequest<{ key: string; value: T } | undefined>,
  );
  return rec?.value;
}

export async function kvSet<T>(key: string, value: T): Promise<void> {
  await tx('kv', 'readwrite', (s) => s.put({ key, value }));
}

export async function kvDelete(key: string): Promise<void> {
  await tx('kv', 'readwrite', (s) => s.delete(key));
}

/** 供备份使用：导出 kv 全部键值（含未来的新键，无需维护白名单） */
export async function getAllKv(): Promise<Array<{ key: string; value: unknown }>> {
  return tx<Array<{ key: string; value: unknown }>>(
    'kv',
    'readonly',
    (s) => s.getAll() as IDBRequest<Array<{ key: string; value: unknown }>>,
  );
}

// ---------------- plans ----------------

export async function putPlan(plan: GeneratedPlan): Promise<void> {
  await tx('plans', 'readwrite', (s) => s.put(plan));
}

export async function getAllPlans(): Promise<GeneratedPlan[]> {
  const all = await tx<GeneratedPlan[]>('plans', 'readonly', (s) => s.getAll() as IDBRequest<GeneratedPlan[]>);
  return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function deletePlan(id: string): Promise<void> {
  await tx('plans', 'readwrite', (s) => s.delete(id));
}

/** 供诊断/测试：清空全部计划（仅显式调用，UI 未暴露） */
export async function clearAllPlans(): Promise<void> {
  await tx('plans', 'readwrite', (s) => s.clear());
}

// ---------------- 用户资源库（手动添加的资源） ----------------

export async function putManualResource(resource: ManualResource): Promise<void> {
  await tx('resources', 'readwrite', (s) => s.put(resource));
}

export async function getAllManualResources(): Promise<ManualResource[]> {
  const all = await tx<ManualResource[]>('resources', 'readonly', (s) =>
    s.getAll() as IDBRequest<ManualResource[]>,
  );
  return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function deleteManualResource(id: string): Promise<void> {
  await tx('resources', 'readwrite', (s) => s.delete(id));
}
