// src/features/plan-generator/db/plannerDB.ts
// 本地 IndexedDB 持久化层（隐私：数据只存在本机浏览器 IndexedDB，绝不上传）。
//
// 数据库结构（mood-task-planner，版本演进只允许"追加"）：
// - store 'kv'        (keyPath: 'key')  —— 个人画像、偏好、反馈、Agent trace 等键值数据
// - store 'plans'     (keyPath: 'id')   —— 生成的计划（任务列表/事件时段表）
// - store 'resources' (keyPath: 'id')   —— 用户手动维护的资源库
// - store 'memory'    (keyPath: 'id')   —— Agent 记忆条目（结论 + 证据 + 置信度）
// - store 'embeddings'(keyPath: 'id')   —— 浏览器端的本地向量索引（桌面端走 Rust SQLite）
// - store 'contentCache'(keyPath: 'id') —— 已抓取正文的**临时**缓存（有 TTL，可一键清除，不进备份）
//
// 本文件只依赖浏览器原生 IndexedDB，无任何网络请求。
//
// 【加密扩展接口】当前版本不加密；将来如需本地加密，建议：
//   1) 新增模块 services/crypto.ts，提供 encrypt(value, key) / decrypt(cipher, key)；
//   2) 密钥经 WebCrypto 生成并存储于 IndexedDB（或系统钥匙串），
//   3) 在 kvSet/putPlan 写盘前加密 value，在读取后解密（保持本文件 API 不变）。
import type { GeneratedPlan, ManualResource, MemoryNote } from '../types';

export const PLANNER_DB_NAME = 'mood-task-planner';
/**
 * v3：新增 memory store（Agent 记忆）。
 * v4：新增 embeddings store（浏览器端向量索引；桌面端存 SQLite，见 src-tauri/src/embeddings.rs）。
 * v5：新增 contentCache store（正文抓取的临时缓存；**刻意与可导出数据分开**，见该 store 的注释）。
 * 兼容策略沿用 IndexedDB 惯例：onupgradeneeded 里逐 store 判存在再创建，
 * 因此从 v1~v4 升级上来的库不会丢数据，也不需要"删库重建"。
 */
export const PLANNER_DB_VERSION = 5;

export const KV_PROFILE = 'habitProfile';
export const KV_LLM_CONFIG = 'llmConfig';
export const KV_PLAN_PREFS = 'planPrefs';
/** 资源与联网设置（三层开关 / SearXNG 地址等） */
export const KV_NETWORKING = 'networkingSettings';
/** 用户点击资源的偏好统计：Record<source, count> */
export const KV_RESOURCE_CLICKS = 'resourceClicks';
/** Agent 是否允许召回/写入长期记忆（默认开启，可在设置页关闭） */
export const KV_MEMORY_ENABLED = 'memoryEnabled';
/** run 级轨迹（保留最近若干条） */
export const KV_TRACES = 'agentTraces';
/** 本地语义检索（向量）设置：开关 / embedding 模型 / 超时 */
export const KV_EMBEDDING = 'embeddingSettings';
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
      if (!db.objectStoreNames.contains('memory')) {
        db.createObjectStore('memory', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('embeddings')) {
        db.createObjectStore('embeddings', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('contentCache')) {
        db.createObjectStore('contentCache', { keyPath: 'id' });
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

type StoreName = 'kv' | 'plans' | 'resources' | 'memory' | 'embeddings' | 'contentCache';

function tx<T>(
  storeName: StoreName,
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

// ---------------- 记忆（Agent Memory：结论 + 证据 + 置信度） ----------------

export async function putMemoryNote(note: MemoryNote): Promise<void> {
  await tx('memory', 'readwrite', (s) => s.put(note));
}

/** 全量读取（按 lastUsedAt 降序）：个人场景下条目量级很小，无需索引与分页 */
export async function getAllMemoryNotes(): Promise<MemoryNote[]> {
  const all = await tx<MemoryNote[]>('memory', 'readonly', (s) => s.getAll() as IDBRequest<MemoryNote[]>);
  return all.sort((a, b) => (a.lastUsedAt < b.lastUsedAt ? 1 : -1));
}

export async function deleteMemoryNote(id: string): Promise<void> {
  await tx('memory', 'readwrite', (s) => s.delete(id));
}

/** 清空全部记忆（设置页"清空记忆"入口；显式操作，不做隐式清理） */
export async function clearAllMemoryNotes(): Promise<void> {
  await tx('memory', 'readwrite', (s) => s.clear());
}

/**
 * 让备份/恢复能覆盖记忆数据：导出与写入整批。
 * 键名带 memory 前缀，避免与计划、资源混淆。
 */
export async function dumpMemoryNotes(): Promise<MemoryNote[]> {
  return getAllMemoryNotes();
}

export async function restoreMemoryNotes(notes: MemoryNote[]): Promise<number> {
  let written = 0;
  for (const note of notes) {
    if (!note || typeof note.id !== 'string' || !note.id) continue;
    await putMemoryNote(note);
    written += 1;
  }
  return written;
}

// ---------------- 本地向量索引（浏览器端；桌面端走 Rust 的 agent_embeddings 表） ----------------
//
// 注意：向量索引**不纳入备份**。原因：①它是可从资源重新计算出来的派生数据；
// ②体积大（768 维 f32 每条 ~3KB，且 JSON 序列化后会膨胀数倍）。
// 备份里保存的是"内容"和"结论"，索引随时可以重建。

export interface EmbeddingDbRow {
  /** `${namespace}::${refId}`：同一 refId 在不同 namespace 下互不覆盖 */
  id: string;
  namespace: string;
  refId: string;
  model: string;
  dim: number;
  contentHash: string;
  vector: number[];
  updatedAt: string;
}

export function embeddingRowId(namespace: string, refId: string): string {
  return `${namespace}::${refId}`;
}

export async function putEmbeddingRows(rows: EmbeddingDbRow[]): Promise<number> {
  let written = 0;
  for (const row of rows) {
    if (!row || !row.id || !Array.isArray(row.vector) || row.vector.length === 0) continue;
    await tx('embeddings', 'readwrite', (s) => s.put(row));
    written += 1;
  }
  return written;
}

export async function getAllEmbeddingRows(): Promise<EmbeddingDbRow[]> {
  return tx<EmbeddingDbRow[]>('embeddings', 'readonly', (s) => s.getAll() as IDBRequest<EmbeddingDbRow[]>);
}

export async function deleteEmbeddingRows(ids: string[]): Promise<number> {
  let removed = 0;
  for (const id of ids) {
    await tx('embeddings', 'readwrite', (s) => s.delete(id));
    removed += 1;
  }
  return removed;
}

export async function clearEmbeddingNamespace(namespace: string): Promise<number> {
  const rows = await getAllEmbeddingRows();
  const ids = rows.filter((r) => r.namespace === namespace).map((r) => r.id);
  return deleteEmbeddingRows(ids);
}

// ---------------- 正文临时缓存（P4） ----------------
//
// **刻意单独一个 store**，而不是塞进 kv：
//   kv 是会被"全量数据备份"整表导出的，而本项目的隐私口径是"只保存标题与链接，不保存网页正文"。
//   把抓到的正文放进独立 store，就保证它既不会被导出，也能被一键清除（TTL 7 天）。

export interface ContentCacheRow {
  /** url 的哈希（作为主键） */
  id: string;
  url: string;
  title: string;
  /** 已清洗的正文（截断到 6000 字） */
  text: string;
  /**
   * 正文的 Markdown 版本（保留标题 / 加粗 / 列表 / 代码块），只服务阅读模式。
   * 可选：v6 之前写入的旧缓存没有这个字段，阅读模式会自动回退到纯文本段落。
   */
  markdown?: string;
  fetchedAt: string;
  hits: number;
}

export async function putContentCacheRows(rows: ContentCacheRow[]): Promise<void> {
  for (const row of rows) {
    if (!row || !row.id) continue;
    await tx('contentCache', 'readwrite', (s) => s.put(row));
  }
}

export async function getAllContentCacheRows(): Promise<ContentCacheRow[]> {
  return tx<ContentCacheRow[]>('contentCache', 'readonly', (s) => s.getAll() as IDBRequest<ContentCacheRow[]>);
}

export async function deleteContentCacheRows(ids: string[]): Promise<number> {
  let removed = 0;
  for (const id of ids) {
    await tx('contentCache', 'readwrite', (s) => s.delete(id));
    removed += 1;
  }
  return removed;
}

export async function clearContentCacheStore(): Promise<number> {
  const rows = await getAllContentCacheRows();
  return deleteContentCacheRows(rows.map((r) => r.id));
}
