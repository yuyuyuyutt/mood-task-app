// src/embeddings.rs
// 本地向量索引的**计算内核**：序列化、归一化、余弦 Top-K。
//
// 为什么把检索放在 Rust 而不是前端：
//   1) 向量是最不该过 IPC 的数据。若在前端算，得先把整表向量拉进 JS
//      （数千条 × 768 维 ≈ 数十 MB 的 JSON）；这里前端只发**一次** query 向量，
//      回传的只有 Top-K 的 ref_id 与分数。
//   2) 写入时就把向量**单位化**，检索退化为点积，省掉每次开方与除零判断。
//
// 本模块只做纯计算，不碰数据库也不碰 Tauri（命令层在 commands.rs），
// 因此可以直接用 `cargo test` 覆盖。
use serde::{Deserialize, Serialize};

/// 一条待写入的向量（前端计算好文本与哈希后传入）
#[derive(Debug, Deserialize)]
pub struct EmbeddingUpsertItem {
    pub ref_id: String,
    pub model: String,
    /// 文本内容哈希（内容没变就不重算 embedding，见前端 planEmbeddingWork）
    pub content_hash: String,
    pub vector: Vec<f32>,
}

/// 已索引条目的摘要（不含向量，用于"跳过没变化的内容"）
#[derive(Debug, Serialize)]
pub struct EmbeddingHashRow {
    pub ref_id: String,
    pub content_hash: String,
}

/// 检索结果（同样不含向量）
#[derive(Debug, Serialize)]
pub struct EmbeddingMatch {
    pub ref_id: String,
    pub score: f32,
    pub content_hash: String,
    pub model: String,
    pub updated_at: String,
}

/// 索引概况（设置页展示"已索引 N 条"）
#[derive(Debug, Serialize)]
pub struct EmbeddingNamespaceStat {
    pub namespace: String,
    pub model: String,
    pub dim: i64,
    pub count: i64,
    pub updated_at: String,
}

/// 从数据库读出的向量行
pub struct VectorRow {
    pub ref_id: String,
    pub vector: Vec<f32>,
    pub content_hash: String,
    pub model: String,
    pub updated_at: String,
}

/// f32 切片 -> 小端字节（SQLite BLOB）。用定长 4 字节小端，读取端不依赖宿主字节序。
pub fn serialize_vector(v: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(v.len() * 4);
    for x in v {
        out.extend_from_slice(&x.to_le_bytes());
    }
    out
}

/// BLOB -> f32 向量；尾部不足 4 字节的残缺数据直接丢弃（不 panic）
pub fn deserialize_vector(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

/// L2 归一化；零向量原样返回，避免除零产生 NaN
pub fn normalize(v: &[f32]) -> Vec<f32> {
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm <= f32::EPSILON {
        return v.to_vec();
    }
    v.iter().map(|x| x / norm).collect()
}

/// 点积。对已单位化的向量即余弦相似度；**维度不一致时返回 0**
/// （换过 embedding 模型就会出现维度不一致，此时应视为不相关而不是报错）
pub fn dot(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() {
        return 0.0;
    }
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

/// 余弦 Top-K：过滤低分、按分数降序、截断到 k 条
pub fn top_k(query: &[f32], rows: Vec<VectorRow>, k: usize, min_score: f32) -> Vec<EmbeddingMatch> {
    let mut scored: Vec<EmbeddingMatch> = rows
        .into_iter()
        .map(|row| {
            let score = dot(query, &row.vector);
            EmbeddingMatch {
                ref_id: row.ref_id,
                score: (score * 10_000.0).round() / 10_000.0,
                content_hash: row.content_hash,
                model: row.model,
                updated_at: row.updated_at,
            }
        })
        .filter(|m| m.score >= min_score)
        .collect();
    // 分数降序；同分时按 ref_id 稳定排序，保证结果可复现
    scored.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.ref_id.cmp(&b.ref_id))
    });
    scored.truncate(k);
    scored
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(ref_id: &str, vector: Vec<f32>) -> VectorRow {
        VectorRow {
            ref_id: ref_id.to_string(),
            vector: normalize(&vector),
            content_hash: format!("h-{}", ref_id),
            model: "test".to_string(),
            updated_at: "2026-09-28T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn vector_bytes_roundtrip() {
        let v = vec![0.5f32, -1.25, 3.0, 0.0];
        let bytes = serialize_vector(&v);
        assert_eq!(bytes.len(), v.len() * 4);
        assert_eq!(deserialize_vector(&bytes), v);
    }

    #[test]
    fn deserialize_ignores_trailing_partial_bytes() {
        let mut bytes = serialize_vector(&[1.0f32, 2.0]);
        bytes.push(0x7f); // 残缺字节
        assert_eq!(deserialize_vector(&bytes), vec![1.0, 2.0]);
    }

    #[test]
    fn normalize_produces_unit_length_and_keeps_zero_vector() {
        let n = normalize(&[3.0, 4.0]);
        assert!((n[0] - 0.6).abs() < 1e-6);
        assert!((n[1] - 0.8).abs() < 1e-6);
        // 零向量不产生 NaN
        assert_eq!(normalize(&[0.0, 0.0]), vec![0.0, 0.0]);
    }

    #[test]
    fn dot_is_cosine_for_normalized_vectors() {
        let a = normalize(&[1.0, 0.0]);
        let b = normalize(&[1.0, 1.0]);
        assert!((dot(&a, &b) - 0.7071).abs() < 1e-3);
        let c = normalize(&[-1.0, 0.0]);
        assert!((dot(&a, &c) + 1.0).abs() < 1e-6);
    }

    #[test]
    fn dot_returns_zero_on_dimension_mismatch() {
        assert_eq!(dot(&[1.0, 2.0, 3.0], &[1.0, 2.0]), 0.0);
    }

    #[test]
    fn top_k_filters_sorts_and_truncates() {
        let query = normalize(&[1.0, 0.0]);
        let rows = vec![
            row("far", vec![-1.0, 0.0]),   // 余弦 -1 → 被阈值过滤
            row("near", vec![2.0, 0.2]),   // 最接近
            row("mid", vec![1.0, 1.0]),    // 次之
        ];
        let hits = top_k(&query, rows, 2, 0.0);
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].ref_id, "near");
        assert_eq!(hits[1].ref_id, "mid");
        assert_eq!(hits[0].content_hash, "h-near");
    }

    #[test]
    fn top_k_is_stable_for_equal_scores() {
        let query = normalize(&[1.0, 0.0]);
        let rows = vec![row("b", vec![2.0, 0.0]), row("a", vec![3.0, 0.0])];
        let hits = top_k(&query, rows, 5, 0.0);
        assert_eq!(hits.iter().map(|h| h.ref_id.as_str()).collect::<Vec<_>>(), vec!["a", "b"]);
    }
}
