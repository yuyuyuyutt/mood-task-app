// src/features/plan-generator/services/rag/vectorStore.ts
// 向量存储的**双后端**实现，沿用项目既有的"双运行时"纪律：
//
//   桌面端（Tauri）：SQLite `agent_embeddings` 表 + **Rust 侧算余弦 Top-K**
//     —— 向量是最不该过 IPC 的数据：前端只发一次 query 向量，回传的只有 refId 与分数。
//   浏览器端（vite dev）：IndexedDB `embeddings` store + 前端算余弦
//     —— 数据量小（本地资源库级别），够用；保证浏览器开发模式也能完整走通。
//
// 两者对上层暴露同一组方法，业务代码通过 createVectorStore() 拿到实例，不感知差异。
import {
  clearEmbeddingNamespace,
  deleteEmbeddingRows,
  embeddingRowId,
  getAllEmbeddingRows,
  putEmbeddingRows,
  type EmbeddingDbRow,
} from '../../db/plannerDB';
import { isTauriRuntime } from '../../../../utils/runtime';
import { cosineSimilarity } from './embedding';

/** 一条待写入的向量记录 */
export interface VectorRecord {
  namespace: string;
  refId: string;
  model: string;
  contentHash: string;
  /** 已归一化的向量（未归一化也可，后端会再归一化一次） */
  vector: number[];
}

/** 检索命中的一条（**不包含向量**） */
export interface VectorMatch {
  refId: string;
  /** 余弦相似度 -1..1 */
  score: number;
  contentHash: string;
  model: string;
  updatedAt: string;
}

export interface VectorBackendStat {
  namespace: string;
  model: string;
  dim: number;
  count: number;
  updatedAt: string;
}

/** 语义召回默认取 Top-8；低于阈值的命中视为"不相关"，不进融合排序 */
export const SEMANTIC_TOP_K = 8;
export const MIN_SEMANTIC_SCORE = 0.2;

/** 后端类型：桌面 SQLite / 浏览器 IndexedDB / 进程内内存（离线评测用） */
export type VectorBackendKind = 'tauri' | 'indexeddb' | 'memory';

export interface VectorStoreBackend {
  readonly kind: VectorBackendKind;
  hashes(namespace: string, model?: string): Promise<Map<string, string>>;
  upsert(namespace: string, records: VectorRecord[]): Promise<number>;
  search(
    namespace: string,
    query: number[],
    topK: number,
    minScore: number,
    model?: string,
  ): Promise<VectorMatch[]>;
  remove(namespace: string, refIds: string[]): Promise<number>;
  clear(namespace: string): Promise<number>;
  stats(): Promise<VectorBackendStat[]>;
}

// ---------------- 桌面端：Rust SQLite ----------------

/** Rust 侧返回的行（字段名与结构体一致，保持 snake_case） */
interface RustHashRow {
  ref_id: string;
  content_hash: string;
}
interface RustMatchRow {
  ref_id: string;
  score: number;
  content_hash: string;
  model: string;
  updated_at: string;
}
interface RustStatRow {
  namespace: string;
  model: string;
  dim: number;
  count: number;
  updated_at: string;
}

export class TauriVectorBackend implements VectorStoreBackend {
  readonly kind = 'tauri' as const;

  /** 动态 import：浏览器模式下不把 Tauri API 打进主包 */
  private async invoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(command, args);
  }

  async hashes(namespace: string, model?: string): Promise<Map<string, string>> {
    const rows = await this.invoke<RustHashRow[]>('embedding_hashes', { namespace, model: model ?? null });
    return new Map((rows ?? []).map((r) => [r.ref_id, r.content_hash]));
  }

  async upsert(namespace: string, records: VectorRecord[]): Promise<number> {
    if (records.length === 0) return 0;
    return this.invoke<number>('embedding_upsert', {
      namespace,
      items: records.map((r) => ({
        ref_id: r.refId,
        model: r.model,
        content_hash: r.contentHash,
        vector: r.vector,
      })),
    });
  }

  async search(
    namespace: string,
    query: number[],
    topK: number,
    minScore: number,
    model?: string,
  ): Promise<VectorMatch[]> {
    if (query.length === 0) return [];
    const rows = await this.invoke<RustMatchRow[]>('embedding_search', {
      namespace,
      query,
      topK,
      minScore,
      model: model ?? null,
    });
    return (rows ?? []).map((r) => ({
      refId: r.ref_id,
      score: r.score,
      contentHash: r.content_hash,
      model: r.model,
      updatedAt: r.updated_at,
    }));
  }

  async remove(namespace: string, refIds: string[]): Promise<number> {
    if (refIds.length === 0) return 0;
    return this.invoke<number>('embedding_delete', { namespace, refIds });
  }

  async clear(namespace: string): Promise<number> {
    return this.invoke<number>('embedding_clear', { namespace });
  }

  async stats(): Promise<VectorBackendStat[]> {
    const rows = await this.invoke<RustStatRow[]>('embedding_stats', {});
    return (rows ?? []).map((r) => ({
      namespace: r.namespace,
      model: r.model,
      dim: r.dim,
      count: r.count,
      updatedAt: r.updated_at,
    }));
  }
}

// ---------------- 浏览器端：IndexedDB ----------------

export class IndexedDbVectorBackend implements VectorStoreBackend {
  readonly kind = 'indexeddb' as const;

  private async rows(namespace: string, model?: string): Promise<EmbeddingDbRow[]> {
    const all = await getAllEmbeddingRows();
    return all.filter((r) => r.namespace === namespace && (!model || r.model === model));
  }

  async hashes(namespace: string, model?: string): Promise<Map<string, string>> {
    const rows = await this.rows(namespace, model);
    return new Map(rows.map((r) => [r.refId, r.contentHash]));
  }

  async upsert(namespace: string, records: VectorRecord[]): Promise<number> {
    const now = new Date().toISOString();
    const rows: EmbeddingDbRow[] = records.map((r) => ({
      id: embeddingRowId(namespace, r.refId),
      namespace,
      refId: r.refId,
      model: r.model,
      dim: r.vector.length,
      contentHash: r.contentHash,
      vector: r.vector,
      updatedAt: now,
    }));
    return putEmbeddingRows(rows);
  }

  async search(
    namespace: string,
    query: number[],
    topK: number,
    minScore: number,
    model?: string,
  ): Promise<VectorMatch[]> {
    if (query.length === 0) return [];
    const rows = await this.rows(namespace, model);
    return rows
      .map((r) => ({
        refId: r.refId,
        score: Math.round(cosineSimilarity(query, r.vector) * 10_000) / 10_000,
        contentHash: r.contentHash,
        model: r.model,
        updatedAt: r.updatedAt,
      }))
      .filter((m) => m.score >= minScore)
      .sort((a, b) => b.score - a.score || a.refId.localeCompare(b.refId))
      .slice(0, topK);
  }

  async remove(namespace: string, refIds: string[]): Promise<number> {
    if (refIds.length === 0) return 0;
    return deleteEmbeddingRows(refIds.map((id) => embeddingRowId(namespace, id)));
  }

  async clear(namespace: string): Promise<number> {
    return clearEmbeddingNamespace(namespace);
  }

  async stats(): Promise<VectorBackendStat[]> {
    const all = await getAllEmbeddingRows();
    const map = new Map<string, VectorBackendStat>();
    for (const row of all) {
      const key = `${row.namespace}::${row.model}::${row.dim}`;
      const prev = map.get(key);
      if (prev) {
        prev.count += 1;
        if (row.updatedAt > prev.updatedAt) prev.updatedAt = row.updatedAt;
      } else {
        map.set(key, {
          namespace: row.namespace,
          model: row.model,
          dim: row.dim,
          count: 1,
          updatedAt: row.updatedAt,
        });
      }
    }
    return [...map.values()];
  }
}

// ---------------- 统一入口 ----------------

export class VectorStore {
  constructor(private readonly backend: VectorStoreBackend) {}

  /** 当前后端类型（UI 上标注"索引存在本机 SQLite / IndexedDB"） */
  get kind(): VectorBackendKind {
    return this.backend.kind;
  }

  hashes(namespace: string, model?: string): Promise<Map<string, string>> {
    return this.backend.hashes(namespace, model);
  }

  upsert(namespace: string, records: VectorRecord[]): Promise<number> {
    return this.backend.upsert(namespace, records);
  }

  search(
    namespace: string,
    query: number[],
    topK: number = SEMANTIC_TOP_K,
    minScore: number = MIN_SEMANTIC_SCORE,
    model?: string,
  ): Promise<VectorMatch[]> {
    return this.backend.search(namespace, query, topK, minScore, model);
  }

  remove(namespace: string, refIds: string[]): Promise<number> {
    return this.backend.remove(namespace, refIds);
  }

  clear(namespace: string): Promise<number> {
    return this.backend.clear(namespace);
  }

  stats(): Promise<VectorBackendStat[]> {
    return this.backend.stats();
  }
}

/** 按运行时选后端（与存储层的 isTauriRuntime() 分叉点保持一致） */
export function createVectorStore(): VectorStore {
  return new VectorStore(isTauriRuntime() ? new TauriVectorBackend() : new IndexedDbVectorBackend());
}
