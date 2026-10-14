// src/commands.rs
use crate::database::{CreateTask, DbPool, Task};
use crate::embeddings::{
    deserialize_vector, normalize, serialize_vector, EmbeddingHashRow, EmbeddingMatch,
    EmbeddingNamespaceStat, EmbeddingUpsertItem, VectorRow,
};
use rusqlite::params;
use rusqlite::types::Value;
use serde::{Deserialize, Serialize};
use tauri::State;

// 全局状态
pub struct AppState {
    pub db_pool: DbPool,
}

// 获取所有任务
#[tauri::command]
pub fn get_tasks(state: State<AppState>) -> Result<Vec<Task>, String> {
    let conn = state
        .db_pool
        .get()
        .map_err(|e: r2d2::Error| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT * FROM tasks ORDER BY created_at DESC")
        .map_err(|e: rusqlite::Error| e.to_string())?;

    let task_iter = stmt
        .query_map([], Task::from_row)
        .map_err(|e: rusqlite::Error| e.to_string())?;

    let tasks: Result<Vec<_>, rusqlite::Error> = task_iter.collect();
    tasks.map_err(|e: rusqlite::Error| e.to_string())
}

// 创建新任务
#[tauri::command]
pub fn create_task(state: State<AppState>, task: CreateTask) -> Result<Task, String> {
    let conn = state
        .db_pool
        .get()
        .map_err(|e: r2d2::Error| e.to_string())?;

    conn.execute(
        "INSERT INTO tasks (
            title, description, status, priority,
            energy_cost, estimated_time, actual_time,
            due_date, completed_at, tags,
            is_habit, habit_period, habit_completions, habit_start_date, habit_end_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            task.title,
            task.description,
            task.status.unwrap_or_else(|| "pending".to_string()),
            task.priority.unwrap_or(2),
            task.energy_cost,
            task.estimated_time,
            task.actual_time,
            task.due_date,
            task.completed_at,
            task.tags,
            task.is_habit.unwrap_or(false),
            task.habit_period,
            task.habit_completions,
            task.habit_start_date,
            task.habit_end_date,
        ],
    )
    .map_err(|e: rusqlite::Error| e.to_string())?;

    let id = conn.last_insert_rowid();
    select_task(&conn, id)
}

/// 可增量更新的列白名单：JSON 键名 -> 数据库列名。
/// 只允许这些列被 patch，杜绝 SQL 注入。
const PATCHABLE_COLUMNS: &[(&str, &str)] = &[
    ("title", "title"),
    ("description", "description"),
    ("status", "status"),
    ("priority", "priority"),
    ("energy_cost", "energy_cost"),
    ("estimated_time", "estimated_time"),
    ("actual_time", "actual_time"),
    ("due_date", "due_date"),
    ("completed_at", "completed_at"),
    ("tags", "tags"),
    ("is_habit", "is_habit"),
    ("habit_period", "habit_period"),
    ("habit_completions", "habit_completions"),
    ("habit_start_date", "habit_start_date"),
    ("habit_end_date", "habit_end_date"),
];

/// 增量更新任务：只写入 patch 中出现的字段，避免"读-改-写"覆盖并发修改。
/// JSON 中的 null 表示"置空该列"。
#[tauri::command]
pub fn patch_task(state: State<AppState>, id: i64, patch: serde_json::Value) -> Result<Task, String> {
    let conn = state
        .db_pool
        .get()
        .map_err(|e: r2d2::Error| e.to_string())?;

    let obj = patch
        .as_object()
        .ok_or_else(|| "patch 必须是 JSON 对象".to_string())?;

    let mut sets: Vec<String> = Vec::new();
    let mut values: Vec<Value> = Vec::new();
    for (key, column) in PATCHABLE_COLUMNS {
        let Some(value) = obj.get(*key) else { continue };
        if value.is_null() {
            sets.push(format!("{} = NULL", column));
            continue;
        }
        sets.push(format!("{} = ?", column));
        values.push(match value {
            serde_json::Value::Bool(b) => Value::Integer(if *b { 1 } else { 0 }),
            serde_json::Value::Number(n) => Value::Integer(n.as_i64().unwrap_or(0)),
            serde_json::Value::String(s) => Value::Text(s.clone()),
            other => Value::Text(other.to_string()),
        });
    }

    if sets.is_empty() {
        return select_task(&conn, id);
    }
    sets.push("updated_at = datetime('now')".to_string());

    let sql = format!("UPDATE tasks SET {} WHERE id = ?", sets.join(", "));
    values.push(Value::Integer(id));
    conn.execute(&sql, rusqlite::params_from_iter(values))
        .map_err(|e: rusqlite::Error| e.to_string())?;

    select_task(&conn, id)
}

// 删除任务
#[tauri::command]
pub fn delete_task(state: State<AppState>, id: i64) -> Result<usize, String> {
    let conn = state
        .db_pool
        .get()
        .map_err(|e: r2d2::Error| e.to_string())?;

    conn.execute("DELETE FROM tasks WHERE id = ?", params![id])
        .map_err(|e: rusqlite::Error| e.to_string())
}

fn select_task(conn: &rusqlite::Connection, id: i64) -> Result<Task, String> {
    let mut stmt = conn
        .prepare("SELECT * FROM tasks WHERE id = ?")
        .map_err(|e: rusqlite::Error| e.to_string())?;
    stmt.query_row(params![id], Task::from_row)
        .map_err(|e: rusqlite::Error| e.to_string())
}

// ============ 插件命名空间数据（长期数据，按 namespace/collection 隔离） ============

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PluginDataRecord {
    pub key: String,
    pub value: String,
    pub updated_at: String,
}

fn row_to_record(row: &rusqlite::Row) -> rusqlite::Result<PluginDataRecord> {
    Ok(PluginDataRecord {
        key: row.get(0)?,
        value: row.get(1)?,
        updated_at: row.get(2)?,
    })
}

// 列出集合内全部记录
#[tauri::command]
pub fn plugin_data_list(
    state: State<AppState>,
    namespace: String,
    collection: String,
) -> Result<Vec<PluginDataRecord>, String> {
    let conn = state
        .db_pool
        .get()
        .map_err(|e: r2d2::Error| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT key, value, updated_at FROM plugin_data
             WHERE namespace = ? AND collection = ? ORDER BY updated_at DESC",
        )
        .map_err(|e: rusqlite::Error| e.to_string())?;

    let iter = stmt
        .query_map(params![namespace, collection], row_to_record)
        .map_err(|e: rusqlite::Error| e.to_string())?;

    let rows: Result<Vec<_>, rusqlite::Error> = iter.collect();
    rows.map_err(|e: rusqlite::Error| e.to_string())
}

// 读取单条记录
#[tauri::command]
pub fn plugin_data_get(
    state: State<AppState>,
    namespace: String,
    collection: String,
    key: String,
) -> Result<Option<PluginDataRecord>, String> {
    let conn = state
        .db_pool
        .get()
        .map_err(|e: r2d2::Error| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT key, value, updated_at FROM plugin_data
             WHERE namespace = ? AND collection = ? AND key = ?",
        )
        .map_err(|e: rusqlite::Error| e.to_string())?;

    match stmt.query_row(params![namespace, collection, key], row_to_record) {
        Ok(rec) => Ok(Some(rec)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// 全量导出插件命名空间数据（备份用）。只被应用自己的备份功能调用，
/// 不暴露给插件：插件仍受 namespace/collection 白名单约束。
#[derive(Debug, Serialize)]
pub struct PluginDataDumpRow {
    pub namespace: String,
    pub collection: String,
    pub key: String,
    pub value: String,
    pub updated_at: String,
}

#[tauri::command]
pub fn plugin_data_dump(state: State<AppState>) -> Result<Vec<PluginDataDumpRow>, String> {
    let conn = state
        .db_pool
        .get()
        .map_err(|e: r2d2::Error| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT namespace, collection, key, value, updated_at FROM plugin_data")
        .map_err(|e: rusqlite::Error| e.to_string())?;

    let iter = stmt
        .query_map([], |row| {
            Ok(PluginDataDumpRow {
                namespace: row.get(0)?,
                collection: row.get(1)?,
                key: row.get(2)?,
                value: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|e: rusqlite::Error| e.to_string())?;

    let rows: Result<Vec<_>, rusqlite::Error> = iter.collect();
    rows.map_err(|e: rusqlite::Error| e.to_string())
}

// 写入/更新记录（UPSERT）
#[tauri::command]
pub fn plugin_data_put(
    state: State<AppState>,
    namespace: String,
    collection: String,
    key: String,
    value: String,
) -> Result<(), String> {
    let conn = state
        .db_pool
        .get()
        .map_err(|e: r2d2::Error| e.to_string())?;

    conn.execute(
        "INSERT INTO plugin_data (namespace, collection, key, value, updated_at)
         VALUES (?1, ?2, ?3, ?4, datetime('now'))
         ON CONFLICT(namespace, collection, key) DO UPDATE SET
            value = excluded.value,
            updated_at = datetime('now')",
        params![namespace, collection, key, value],
    )
    .map_err(|e: rusqlite::Error| e.to_string())?;

    Ok(())
}

// 删除单条记录
#[tauri::command]
pub fn plugin_data_delete(
    state: State<AppState>,
    namespace: String,
    collection: String,
    key: String,
) -> Result<usize, String> {
    let conn = state
        .db_pool
        .get()
        .map_err(|e: r2d2::Error| e.to_string())?;

    conn.execute(
        "DELETE FROM plugin_data WHERE namespace = ? AND collection = ? AND key = ?",
        params![namespace, collection, key],
    )
    .map_err(|e: rusqlite::Error| e.to_string())
}

// 清空集合
#[tauri::command]
pub fn plugin_data_clear(
    state: State<AppState>,
    namespace: String,
    collection: String,
) -> Result<usize, String> {
    let conn = state
        .db_pool
        .get()
        .map_err(|e: r2d2::Error| e.to_string())?;

    conn.execute(
        "DELETE FROM plugin_data WHERE namespace = ? AND collection = ?",
        params![namespace, collection],
    )
    .map_err(|e: rusqlite::Error| e.to_string())
}

// 清空整个命名空间（保留期到期/回收站清除用）
#[tauri::command]
pub fn plugin_data_clear_namespace(
    state: State<AppState>,
    namespace: String,
) -> Result<usize, String> {
    let conn = state
        .db_pool
        .get()
        .map_err(|e: r2d2::Error| e.to_string())?;

    conn.execute(
        "DELETE FROM plugin_data WHERE namespace = ?",
        params![namespace],
    )
    .map_err(|e: rusqlite::Error| e.to_string())
}

// ==================== 计划生成器：资源采集（Rust 侧代理） ====================
//
// 背景：浏览器 / WebView 受同源策略约束，B 站与 SearXNG 的接口都会因 CORS 直接失败
// （服务端 403 + 响应无 Access-Control-Allow-Origin，浏览器统一报成 CORS 违规）。
// 因此这两层的网络请求全部挪到 Rust 侧，前端通过 invoke 调用。
//
// 关键约束：
// - 两个命令的返回结构必须与前端 ResourceItem 的映射逻辑对得上（字段名保持 snake_case）；
// - 任何失败都返回 Err(String)，由前端静默降级（不抛出、不阻断三层编排）；
// - HTML 清洗在 Rust 侧完成，减少 IPC 传输量。

/// B 站搜索结果条目（精简后，只保留前端需要的字段）
#[derive(Debug, Clone, Serialize)]
pub struct BilibiliVideo {
    pub bvid: String,
    pub title: String,
    pub author: Option<String>,
    /// 形如 "12:34" / "1:02:03"，保持原始字符串，由前端换算分钟
    pub duration: Option<String>,
    pub play: Option<i64>,
    pub like: Option<i64>,
    pub favorites: Option<i64>,
    pub pubdate: Option<i64>,
    pub description: Option<String>,
    pub arcurl: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BilibiliSearchResponse {
    pub items: Vec<BilibiliVideo>,
    /// 实际使用的接口（便于诊断）
    pub endpoint: String,
}

/// 清洗 B 站标题中的 HTML 高亮标签与实体（搜索接口返回的 title 带 <em class="keyword">）
fn clean_html(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut in_tag = false;
    for ch in raw.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    // 实体解码（只处理 B 站实际会出现的几种）
    let out = out
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
        .replace("&amp;", "&");
    // 折叠连续空白
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 从 serde_json::Value 中安全取字符串
fn as_str(v: &serde_json::Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(|s| s.to_string())
}

/// 从 serde_json::Value 中安全取整数
fn as_i64(v: &serde_json::Value, key: &str) -> Option<i64> {
    v.get(key).and_then(|x| x.as_i64())
}

/// 搜索 B 站视频（Rust 侧代理，绕开浏览器 CORS）。
///
/// 使用 `wbi/search/type` 接口，实测无需 wbi 签名即可返回 code:0。
/// 注意：B 站的旧接口 `/x/web-interface/search/all/v2` 与 `/x/web-interface/nav`
/// 对无 Cookie 请求返回 403，因此这里不再走那条降级路径。
#[tauri::command]
pub async fn search_bilibili(
    keyword: String,
    page: Option<u32>,
    timeout_ms: Option<u64>,
) -> Result<BilibiliSearchResponse, String> {
    const SEARCH_TYPE_URL: &str = "https://api.bilibili.com/x/web-interface/wbi/search/type";

    let page = page.unwrap_or(1);
    let url = format!(
        "{}?search_type=video&keyword={}&page={}",
        SEARCH_TYPE_URL,
        urlencoding::encode(&keyword),
        page
    );

    let json = crate::http::fetch_json(&url, Some("https://www.bilibili.com/"), timeout_ms).await?;

    let code = as_i64(&json, "code").unwrap_or(-1);
    if code != 0 {
        let msg = as_str(&json, "message").unwrap_or_else(|| "未知错误".to_string());
        return Err(format!("B 站接口返回 code={} {}", code, msg));
    }

    let raw_items = json
        .get("data")
        .and_then(|d| d.get("result"))
        .and_then(|r| r.as_array())
        .cloned()
        .unwrap_or_default();

    let mut items = Vec::with_capacity(raw_items.len());
    for raw in &raw_items {
        // 只要视频类型
        if let Some(t) = as_str(raw, "type") {
            if t != "video" {
                continue;
            }
        }
        let title = clean_html(&as_str(raw, "title").unwrap_or_default());
        if title.chars().count() < 2 {
            continue;
        }
        let bvid = as_str(raw, "bvid").unwrap_or_default();
        if bvid.is_empty() {
            continue;
        }
        let description = as_str(raw, "description").map(|d| {
            let cleaned = clean_html(&d);
            cleaned.chars().take(160).collect::<String>()
        });
        items.push(BilibiliVideo {
            bvid,
            title,
            author: as_str(raw, "author").map(|a| clean_html(&a)),
            duration: as_str(raw, "duration"),
            play: as_i64(raw, "play"),
            like: as_i64(raw, "like"),
            favorites: as_i64(raw, "favorites"),
            pubdate: as_i64(raw, "pubdate"),
            description,
            arcurl: as_str(raw, "arcurl"),
        });
    }

    Ok(BilibiliSearchResponse {
        items,
        endpoint: "wbi/search/type(rust)".to_string(),
    })
}

/// SearXNG 搜索结果条目（精简后）
#[derive(Debug, Clone, Serialize)]
pub struct SearxngItem {
    pub url: String,
    pub title: String,
    pub content: Option<String>,
    pub engine: Option<String>,
    pub published_date: Option<String>,
    pub score: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearxngSearchResponse {
    pub items: Vec<SearxngItem>,
}

/// 搜索本地 SearXNG 实例（Rust 侧代理，绕开浏览器 CORS）。
///
/// 常见失败：SearXNG 默认只输出 html，`format=json` 会返回 403。
/// 此时提示用户去 settings.yml 的 `search.formats` 里补上 `json`。
#[tauri::command]
pub async fn search_searxng(
    keyword: String,
    base_url: String,
    engines: Option<Vec<String>>,
    timeout_ms: Option<u64>,
) -> Result<SearxngSearchResponse, String> {
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("未配置 SearXNG 实例地址".to_string());
    }

    let mut url = format!(
        "{}/search?q={}&format=json&language=zh-CN",
        base,
        urlencoding::encode(&keyword)
    );
    if let Some(list) = engines.as_ref() {
        if !list.is_empty() {
            url.push_str(&format!("&engines={}", urlencoding::encode(&list.join(","))));
        }
    }

    let json = crate::http::fetch_json(&url, None, timeout_ms)
        .await
        .map_err(|e| {
            if e.contains("403") {
                "SearXNG 返回 403：请在 settings.yml 的 search.formats 中加入 json 后重启实例".to_string()
            } else {
                format!("SearXNG 请求失败：{}", e)
            }
        })?;

    if let Some(err) = as_str(&json, "error") {
        return Err(format!("SearXNG 返回错误：{}", err));
    }

    let raw_items = json
        .get("results")
        .and_then(|r| r.as_array())
        .cloned()
        .unwrap_or_default();

    let mut items = Vec::with_capacity(raw_items.len());
    for raw in &raw_items {
        let url = as_str(raw, "url").unwrap_or_default();
        let title = as_str(raw, "title")
            .unwrap_or_default()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        if !url.starts_with("http://") && !url.starts_with("https://") {
            continue;
        }
        if title.chars().count() < 2 {
            continue;
        }
        let content = as_str(raw, "content").map(|c| {
            c.split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .chars()
                .take(200)
                .collect::<String>()
        });
        items.push(SearxngItem {
            url,
            title: title.chars().take(160).collect(),
            content,
            engine: as_str(raw, "engine"),
            published_date: as_str(raw, "publishedDate"),
            score: raw.get("score").and_then(|s| s.as_f64()),
        });
    }

    Ok(SearxngSearchResponse { items })
}

// ==================== 本地向量索引（语义检索 RAG） ====================
//
// 设计要点（与前端的契约）：
//   1) **向量不过 IPC**：前端只发一次 query 向量，这里做余弦 Top-K，
//      只回传 ref_id + 分数 + 元信息；整表向量永远留在 SQLite。
//   2) 写入时统一 L2 归一化，检索退化为点积。
//   3) 按 (namespace, ref_id) 覆盖；namespace 隔离不同用途的索引（当前只有 'resource'）。
//   4) model 参与过滤：换 embedding 模型等于换向量空间，旧向量不能与新 query 比较。

/// 取某个 namespace 下已索引条目的内容哈希：前端据此只重算"内容变了的"那部分
#[tauri::command]
pub fn embedding_hashes(
    state: State<AppState>,
    namespace: String,
    model: Option<String>,
) -> Result<Vec<EmbeddingHashRow>, String> {
    let conn = state
        .db_pool
        .get()
        .map_err(|e: r2d2::Error| e.to_string())?;
    let model = model.unwrap_or_default();
    let mut stmt = conn
        .prepare(
            "SELECT ref_id, content_hash FROM agent_embeddings
             WHERE namespace = ?1 AND (?2 = '' OR model = ?2)",
        )
        .map_err(|e: rusqlite::Error| e.to_string())?;
    let rows = stmt
        .query_map(params![&namespace, &model], |r| {
            Ok(EmbeddingHashRow {
                ref_id: r.get(0)?,
                content_hash: r.get(1)?,
            })
        })
        .map_err(|e: rusqlite::Error| e.to_string())?;
    let collected: Result<Vec<_>, rusqlite::Error> = rows.collect();
    collected.map_err(|e: rusqlite::Error| e.to_string())
}

/// 批量写入 / 更新向量（事务内完成，单条失败不留下半成品）
#[tauri::command]
pub fn embedding_upsert(
    state: State<AppState>,
    namespace: String,
    items: Vec<EmbeddingUpsertItem>,
) -> Result<u32, String> {
    if items.is_empty() {
        return Ok(0);
    }
    let mut conn = state
        .db_pool
        .get()
        .map_err(|e: r2d2::Error| e.to_string())?;
    let tx = conn.transaction().map_err(|e: rusqlite::Error| e.to_string())?;
    let mut written = 0u32;
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO agent_embeddings
                    (namespace, ref_id, model, dim, content_hash, vector, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))
                 ON CONFLICT(namespace, ref_id) DO UPDATE SET
                    model = excluded.model,
                    dim = excluded.dim,
                    content_hash = excluded.content_hash,
                    vector = excluded.vector,
                    updated_at = datetime('now')",
            )
            .map_err(|e: rusqlite::Error| e.to_string())?;
        for item in items {
            if item.vector.is_empty() {
                continue;
            }
            let vector = normalize(&item.vector);
            let dim = vector.len() as i64;
            stmt.execute(params![
                &namespace,
                &item.ref_id,
                &item.model,
                dim,
                &item.content_hash,
                serialize_vector(&vector),
            ])
            .map_err(|e: rusqlite::Error| format!("写入向量失败：{}", e))?;
            written += 1;
        }
    }
    tx.commit().map_err(|e: rusqlite::Error| e.to_string())?;
    Ok(written)
}

/// 余弦 Top-K 检索（query 会被归一化；维度不一致的历史向量得 0 分并被阈值过滤）
#[tauri::command]
pub fn embedding_search(
    state: State<AppState>,
    namespace: String,
    query: Vec<f32>,
    top_k: Option<u32>,
    min_score: Option<f64>,
    model: Option<String>,
) -> Result<Vec<EmbeddingMatch>, String> {
    if query.is_empty() {
        return Err("query 向量为空".to_string());
    }
    let conn = state
        .db_pool
        .get()
        .map_err(|e: r2d2::Error| e.to_string())?;
    let model = model.unwrap_or_default();
    let mut stmt = conn
        .prepare(
            "SELECT ref_id, vector, content_hash, model, updated_at FROM agent_embeddings
             WHERE namespace = ?1 AND (?2 = '' OR model = ?2)",
        )
        .map_err(|e: rusqlite::Error| e.to_string())?;
    let rows = stmt
        .query_map(params![&namespace, &model], |r| {
            let blob: Vec<u8> = r.get(1)?;
            Ok(VectorRow {
                ref_id: r.get(0)?,
                vector: deserialize_vector(&blob),
                content_hash: r.get(2)?,
                model: r.get(3)?,
                updated_at: r.get::<_, Option<String>>(4)?.unwrap_or_default(),
            })
        })
        .map_err(|e: rusqlite::Error| e.to_string())?;
    let collected: Result<Vec<_>, rusqlite::Error> = rows.collect();
    let rows = collected.map_err(|e: rusqlite::Error| e.to_string())?;

    let normalized = normalize(&query);
    let limit = top_k.unwrap_or(10).min(100) as usize;
    let threshold = min_score.unwrap_or(0.0) as f32;
    // 用全路径调用，避免与参数名 top_k 撞名
    Ok(crate::embeddings::top_k(&normalized, rows, limit, threshold))
}

/// 删除若干条目（资源被删除 / 内容重建时使用）
#[tauri::command]
pub fn embedding_delete(
    state: State<AppState>,
    namespace: String,
    ref_ids: Vec<String>,
) -> Result<u32, String> {
    if ref_ids.is_empty() {
        return Ok(0);
    }
    let conn = state
        .db_pool
        .get()
        .map_err(|e: r2d2::Error| e.to_string())?;
    // 占位符按数量生成，值全部走绑定参数（不拼接用户输入）
    let placeholders = std::iter::repeat("?")
        .take(ref_ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "DELETE FROM agent_embeddings WHERE namespace = ? AND ref_id IN ({})",
        placeholders
    );
    let mut values: Vec<Value> = Vec::with_capacity(ref_ids.len() + 1);
    values.push(Value::Text(namespace));
    for id in ref_ids {
        values.push(Value::Text(id));
    }
    let removed = conn
        .execute(&sql, rusqlite::params_from_iter(values))
        .map_err(|e: rusqlite::Error| e.to_string())?;
    Ok(removed as u32)
}

/// 清空索引（给定 namespace 或全部）
#[tauri::command]
pub fn embedding_clear(state: State<AppState>, namespace: Option<String>) -> Result<u32, String> {
    let conn = state
        .db_pool
        .get()
        .map_err(|e: r2d2::Error| e.to_string())?;
    let removed = match namespace {
        Some(ns) => conn.execute("DELETE FROM agent_embeddings WHERE namespace = ?1", params![ns]),
        None => conn.execute("DELETE FROM agent_embeddings", []),
    }
    .map_err(|e: rusqlite::Error| e.to_string())?;
    Ok(removed as u32)
}

/// 索引概况（设置页展示"已索引 N 条 / 维度"）
#[tauri::command]
pub fn embedding_stats(state: State<AppState>) -> Result<Vec<EmbeddingNamespaceStat>, String> {
    let conn = state
        .db_pool
        .get()
        .map_err(|e: r2d2::Error| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT namespace, model, dim, COUNT(*), COALESCE(MAX(updated_at), '')
             FROM agent_embeddings GROUP BY namespace, model, dim ORDER BY namespace",
        )
        .map_err(|e: rusqlite::Error| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(EmbeddingNamespaceStat {
                namespace: r.get(0)?,
                model: r.get(1)?,
                dim: r.get(2)?,
                count: r.get(3)?,
                updated_at: r.get(4)?,
            })
        })
        .map_err(|e: rusqlite::Error| e.to_string())?;
    let collected: Result<Vec<_>, rusqlite::Error> = rows.collect();
    collected.map_err(|e: rusqlite::Error| e.to_string())
}

// ==================== 正文抓取（P4：内容级 RAG 增强） ====================
//
// 前端受同源策略约束，抓任意站点（豆瓣 / 掘金 / 个人博客）必然被 CORS 拦，
// 因此与 B 站 / SearXNG 一样走 Rust 代理。这里额外做两件前端做不到的事：
//   1) **SSRF 防护**：拒绝本机 / 内网 / 链路本地地址（前端白名单是产品策略，这里是硬边界）；
//   2) **体积与清洗**：下载字节上限 + HTML → 纯文本，减少 IPC 传输量与 prompt 体积。

#[derive(Debug, Serialize)]
pub struct PageText {
    pub url: String,
    /// 从 <title> 提取（非 HTML 内容为空）
    pub title: String,
    /// 已清洗的正文（按 max_chars 截断）—— 服务检索与证据流水线，标记越少越好
    pub text: String,
    /// 同一份正文的 **Markdown 版本**（保留标题 / 加粗 / 列表 / 代码块 / 引用 / 链接）——
    /// 只服务阅读模式。非 HTML 且非 markdown 的响应为空串。
    pub markdown: String,
    pub content_type: String,
    /// 是否因为下载上限被截断
    pub truncated: bool,
}

#[tauri::command]
pub async fn fetch_page_text(
    url: String,
    timeout_ms: Option<u64>,
    max_chars: Option<usize>,
) -> Result<PageText, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|e| format!("URL 不合法：{}", e))?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err("只允许抓取 http(s) 链接".to_string());
    }
    let host = parsed.host_str().unwrap_or("").to_string();
    if !crate::content::is_public_host(&host) {
        return Err(format!("已拒绝抓取本机 / 内网地址：{}", host));
    }

    let (content_type, body) =
        crate::http::fetch_text(&url, timeout_ms, crate::content::MAX_BYTES).await?;

    let limit = max_chars
        .unwrap_or(crate::content::MAX_TEXT_CHARS)
        .clamp(200, crate::content::MAX_TEXT_CHARS);
    let lower = content_type.to_ascii_lowercase();
    let is_markup = lower.is_empty() || lower.contains("html") || lower.contains("xml");

    let title = if is_markup {
        crate::content::extract_title(&body)
    } else {
        String::new()
    };
    let text = if is_markup {
        crate::content::html_to_text(&body, limit)
    } else {
        crate::content::truncate_chars(
            &body.split_whitespace().collect::<Vec<_>>().join(" "),
            limit,
        )
    };

    // 阅读模式专用：HTML 走结构化转换；本来就是 markdown 的响应直接原样截断
    //（GitHub README / 文档站的 .md 链接属于这一类，它们的"原网站格式"就是 markdown 本身）
    let markdown = if is_markup {
        crate::content::html_to_markdown(&body, limit)
    } else if lower.contains("markdown") {
        crate::content::truncate_chars(&body, limit)
    } else {
        String::new()
    };

    Ok(PageText {
        url,
        title,
        text,
        markdown,
        content_type,
        truncated: body.len() >= crate::content::MAX_BYTES,
    })
}

