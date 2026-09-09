// src/commands.rs
use crate::database::{CreateMood, CreateTask, DbPool, Mood, Task};
use chrono;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json;
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
            due_date, tags,
            is_habit, habit_period, habit_completions, habit_start_date, habit_end_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            task.title,
            task.description,
            task.status.unwrap_or_else(|| "pending".to_string()),
            task.priority.unwrap_or(2),
            task.energy_cost,
            task.estimated_time,
            task.actual_time,
            task.due_date,
            task.tags,
            // 新增习惯任务字段
            task.is_habit.unwrap_or(false),
            task.habit_period,
            task.habit_completions,
            task.habit_start_date,
            task.habit_end_date,
        ],
    )
    .map_err(|e: rusqlite::Error| e.to_string())?;

    let id = conn.last_insert_rowid();

    // 返回刚创建的任务
    let mut stmt = conn
        .prepare("SELECT * FROM tasks WHERE id = ?")
        .map_err(|e: rusqlite::Error| e.to_string())?;

    stmt.query_row(params![id], Task::from_row)
        .map_err(|e: rusqlite::Error| e.to_string())
}

// 更新任务
#[tauri::command]
pub fn update_task(state: State<AppState>, id: i64, task: CreateTask) -> Result<usize, String> {
    let conn = state
        .db_pool
        .get()
        .map_err(|e: r2d2::Error| e.to_string())?;

    let rows_affected = conn
        .execute(
            "UPDATE tasks SET 
            title = ?, description = ?, status = ?, priority = ?, 
            energy_cost = ?, estimated_time = ?, actual_time = ?, 
            due_date = ?, tags = ?,
            is_habit = ?, habit_period = ?, habit_completions = ?, 
            habit_start_date = ?, habit_end_date = ?
        WHERE id = ?",
            params![
                task.title,
                task.description,
                task.status.unwrap_or_else(|| "pending".to_string()),
                task.priority.unwrap_or(2),
                task.energy_cost,
                task.estimated_time,
                task.actual_time,
                task.due_date,
                task.tags,
                // 新增字段
                task.is_habit.unwrap_or(false),
                task.habit_period,
                task.habit_completions,
                task.habit_start_date,
                task.habit_end_date,
                id,
            ],
        )
        .map_err(|e: rusqlite::Error| e.to_string())?;

    Ok(rows_affected)
}

// 删除任务
#[tauri::command]
pub fn delete_task(state: State<AppState>, id: i64) -> Result<usize, String> {
    let conn = state
        .db_pool
        .get()
        .map_err(|e: r2d2::Error| e.to_string())?;

    let rows_affected = conn
        .execute("DELETE FROM tasks WHERE id = ?", params![id])
        .map_err(|e: rusqlite::Error| e.to_string())?;

    Ok(rows_affected)
}

// 更新习惯任务完成状态
#[tauri::command]
pub fn update_habit_completion(
    state: State<AppState>,
    task_id: i64,
    date: String,
    status: String,
    note: Option<String>,
) -> Result<Task, String> {
    let conn = state
        .db_pool
        .get()
        .map_err(|e: r2d2::Error| e.to_string())?;

    // 首先获取当前任务
    let mut stmt = conn
        .prepare("SELECT * FROM tasks WHERE id = ?")
        .map_err(|e: rusqlite::Error| e.to_string())?;

    let task = stmt
        .query_row(params![task_id], Task::from_row)
        .map_err(|e: rusqlite::Error| e.to_string())?;

    // 解析现有的完成记录
    let mut completions: Vec<serde_json::Value> =
        if let Some(completions_str) = &task.habit_completions {
            serde_json::from_str(completions_str).unwrap_or_else(|_| vec![])
        } else {
            vec![]
        };

    // 检查是否已存在该日期的记录
    let existing_index = completions
        .iter()
        .position(|c| c.get("date").and_then(|d| d.as_str()) == Some(&date));

    // 创建新的完成记录
    let completion = serde_json::json!({
        "date": date,
        "completed_at": chrono::Local::now().to_rfc3339(),
        "status": status,
        "note": note
    });

    if let Some(index) = existing_index {
        completions[index] = completion;
    } else {
        completions.push(completion);
    }

    // 更新完成记录
    let completions_str =
        serde_json::to_string(&completions).map_err(|e: serde_json::Error| e.to_string())?;

    conn.execute(
        "UPDATE tasks SET habit_completions = ? WHERE id = ?",
        params![completions_str, task_id],
    )
    .map_err(|e: rusqlite::Error| e.to_string())?;

    // 返回更新后的任务
    let mut stmt = conn
        .prepare("SELECT * FROM tasks WHERE id = ?")
        .map_err(|e: rusqlite::Error| e.to_string())?;

    stmt.query_row(params![task_id], Task::from_row)
        .map_err(|e: rusqlite::Error| e.to_string())
}

// 获取所有心情记录
#[tauri::command]
pub fn get_moods(state: State<AppState>) -> Result<Vec<Mood>, String> {
    let conn = state
        .db_pool
        .get()
        .map_err(|e: r2d2::Error| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT * FROM moods ORDER BY date DESC")
        .map_err(|e: rusqlite::Error| e.to_string())?;

    let mood_iter = stmt
        .query_map([], Mood::from_row)
        .map_err(|e: rusqlite::Error| e.to_string())?;

    let moods: Result<Vec<_>, rusqlite::Error> = mood_iter.collect();
    moods.map_err(|e: rusqlite::Error| e.to_string())
}

// 保存心情记录（创建或更新）
#[tauri::command]
pub fn save_mood(state: State<AppState>, mood: CreateMood) -> Result<Mood, String> {
    let conn = state
        .db_pool
        .get()
        .map_err(|e: r2d2::Error| e.to_string())?;

    // 使用 UPSERT (ON CONFLICT)
    conn.execute(
        "INSERT INTO moods (date, mood_score, mood_emoji, content, tags)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(date) DO UPDATE SET 
            mood_score = excluded.mood_score,
            mood_emoji = excluded.mood_emoji,
            content = excluded.content,
            tags = excluded.tags",
        params![
            mood.date,
            mood.mood_score,
            mood.mood_emoji,
            mood.content,
            mood.tags,
        ],
    )
    .map_err(|e: rusqlite::Error| e.to_string())?;

    // 返回保存的心情记录
    let mut stmt = conn
        .prepare("SELECT * FROM moods WHERE date = ?")
        .map_err(|e: rusqlite::Error| e.to_string())?;

    stmt.query_row(params![mood.date], Mood::from_row)
        .map_err(|e: rusqlite::Error| e.to_string())
}

// 删除心情记录
#[tauri::command]
pub fn delete_mood(state: State<AppState>, id: i64) -> Result<usize, String> {
    let conn = state
        .db_pool
        .get()
        .map_err(|e: r2d2::Error| e.to_string())?;

    let rows_affected = conn
        .execute("DELETE FROM moods WHERE id = ?", params![id])
        .map_err(|e: rusqlite::Error| e.to_string())?;

    Ok(rows_affected)
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
