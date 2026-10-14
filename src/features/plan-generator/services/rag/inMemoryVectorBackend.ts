// src/features/plan-generator/services/rag/inMemoryVectorBackend.ts
// 第三种向量后端：**进程内内存实现**。
//
// 为什么它是产品代码而不是测试代码：
//   1) 离线评测（`services/eval/*`）要在没有 IndexedDB / SQLite 的 node 环境里跑**真实检索链路**，
//      否则评测只能覆盖"降级路径"，覆盖不到语义召回本身；
//   2) 它是 `VectorStoreBackend` 的第三个实现，正好证明这层抽象是成立的
//      （Tauri → SQLite、浏览器 → IndexedDB、评测 → 内存）。
//
// 语义与另外两个后端保持一致：写入时不做归一化（调用方已归一化），检索用点积当余弦。
import { cosineSimilarity } from './embedding';
import type {
  VectorBackendStat,
  VectorMatch,
  VectorRecord,
  VectorStoreBackend,
} from './vectorStore';

export class InMemoryVectorBackend implements VectorStoreBackend {
  readonly kind = 'memory' as const;
  /** key = `${namespace}::${refId}` */
  readonly rows = new Map<string, { model: string; hash: string; vector: number[] }>();
  upsertCalls = 0;
  searchCalls = 0;

  async hashes(namespace: string, model?: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const [key, value] of this.rows) {
      const [ns, refId] = key.split('::');
      if (ns !== namespace) continue;
      if (model && value.model !== model) continue;
      out.set(refId, value.hash);
    }
    return out;
  }

  async upsert(namespace: string, records: VectorRecord[]): Promise<number> {
    this.upsertCalls += 1;
    for (const r of records) {
      this.rows.set(`${namespace}::${r.refId}`, {
        model: r.model,
        hash: r.contentHash,
        vector: r.vector,
      });
    }
    return records.length;
  }

  async search(
    namespace: string,
    query: number[],
    topK: number,
    minScore: number,
    model?: string,
  ): Promise<VectorMatch[]> {
    this.searchCalls += 1;
    const out: VectorMatch[] = [];
    for (const [key, value] of this.rows) {
      const [ns, refId] = key.split('::');
      if (ns !== namespace || (model && value.model !== model)) continue;
      out.push({
        refId,
        score: Math.round(cosineSimilarity(query, value.vector) * 10_000) / 10_000,
        contentHash: value.hash,
        model: value.model,
        updatedAt: '1970-01-01T00:00:00.000Z',
      });
    }
    return out
      .filter((m) => m.score >= minScore)
      .sort((a, b) => b.score - a.score || a.refId.localeCompare(b.refId))
      .slice(0, topK);
  }

  async remove(namespace: string, refIds: string[]): Promise<number> {
    let removed = 0;
    for (const id of refIds) {
      if (this.rows.delete(`${namespace}::${id}`)) removed += 1;
    }
    return removed;
  }

  async clear(namespace: string): Promise<number> {
    let removed = 0;
    for (const key of [...this.rows.keys()]) {
      if (key.startsWith(`${namespace}::`)) {
        this.rows.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  async stats(): Promise<VectorBackendStat[]> {
    const map = new Map<string, VectorBackendStat>();
    for (const [key, value] of this.rows) {
      const namespace = key.split('::')[0];
      const id = `${namespace}::${value.model}::${value.vector.length}`;
      const prev = map.get(id);
      if (prev) prev.count += 1;
      else {
        map.set(id, {
          namespace,
          model: value.model,
          dim: value.vector.length,
          count: 1,
          updatedAt: '1970-01-01T00:00:00.000Z',
        });
      }
    }
    return [...map.values()];
  }
}
