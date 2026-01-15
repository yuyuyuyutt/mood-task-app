// src/commands.rs
use crate::database::{Task, Mood, CreateTask, CreateMood, DbPool};
use rusqlite::params;
use tauri::State;

// 全局状态
pub struct AppState {
    pub db_pool: DbPool,
}

// 辅助函数：获取数据库连接
fn get_conn(state: &State<AppState>) -> Result<r2d2::PooledConnection<r2d2_sqlite::SqliteConnectionManager>, String> {
    state.db_pool.get()
        .map_err(|e: r2d2::Error| format!("获取数据库连接失败: {}", e))
}

// 获取所有任务
#[tauri::command]
pub fn get_tasks(state: State<AppState>) -> Result<Vec<Task>, String> {
    let conn = get_conn(&state)?;
    
    let mut stmt = conn
        .prepare("SELECT * FROM tasks ORDER BY created_at DESC")
        .map_err(|e: rusqlite::Error| format!("准备SQL语句失败: {}", e))?;
    
    let task_iter = stmt
        .query_map([], Task::from_row)
        .map_err(|e: rusqlite::Error| format!("查询任务失败: {}", e))?;
    
    let tasks: Result<Vec<_>, rusqlite::Error> = task_iter.collect();
    tasks.map_err(|e| format!("收集任务数据失败: {}", e))
}

// 创建新任务
#[tauri::command]
pub fn create_task(
    state: State<AppState>,
    task: CreateTask,
) -> Result<Task, String> {
    let conn = get_conn(&state)?;
    
    conn.execute(
        "INSERT INTO tasks (
            title, description, status, priority, 
            energy_cost, estimated_time, actual_time, 
            due_date, tags
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
        ],
    ).map_err(|e: rusqlite::Error| format!("插入任务失败: {}", e))?;
    
    let id = conn.last_insert_rowid();
    
    // 返回刚创建的任务
    let mut stmt = conn
        .prepare("SELECT * FROM tasks WHERE id = ?")
        .map_err(|e: rusqlite::Error| format!("准备查询语句失败: {}", e))?;
    
    stmt.query_row(params![id], Task::from_row)
        .map_err(|e: rusqlite::Error| format!("查询新任务失败: {}", e))
}

// 更新任务
#[tauri::command]
pub fn update_task(
    state: State<AppState>,
    id: i64,
    task: CreateTask,
) -> Result<usize, String> {
    let conn = get_conn(&state)?;
    
    let rows_affected = conn.execute(
        "UPDATE tasks SET 
            title = ?, description = ?, status = ?, priority = ?, 
            energy_cost = ?, estimated_time = ?, actual_time = ?, 
            due_date = ?, tags = ?
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
            id,
        ],
    ).map_err(|e: rusqlite::Error| format!("更新任务失败: {}", e))?;
    
    Ok(rows_affected)
}

// 删除任务
#[tauri::command]
pub fn delete_task(state: State<AppState>, id: i64) -> Result<usize, String> {
    let conn = get_conn(&state)?;
    
    let rows_affected = conn
        .execute("DELETE FROM tasks WHERE id = ?", params![id])
        .map_err(|e: rusqlite::Error| format!("删除任务失败: {}", e))?;
    
    Ok(rows_affected)
}

// 获取所有心情记录
#[tauri::command]
pub fn get_moods(state: State<AppState>) -> Result<Vec<Mood>, String> {
    let conn = get_conn(&state)?;
    
    let mut stmt = conn
        .prepare("SELECT * FROM moods ORDER BY date DESC")
        .map_err(|e: rusqlite::Error| format!("准备SQL语句失败: {}", e))?;
    
    let mood_iter = stmt
        .query_map([], Mood::from_row)
        .map_err(|e: rusqlite::Error| format!("查询心情失败: {}", e))?;
    
    let moods: Result<Vec<_>, rusqlite::Error> = mood_iter.collect();
    moods.map_err(|e| format!("收集心情数据失败: {}", e))
}

// 保存心情记录（创建或更新）
#[tauri::command]
pub fn save_mood(
    state: State<AppState>,
    mood: CreateMood,
) -> Result<Mood, String> {
    let conn = get_conn(&state)?;
    
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
    ).map_err(|e: rusqlite::Error| format!("保存心情失败: {}", e))?;
    
    // 返回保存的心情记录
    let mut stmt = conn
        .prepare("SELECT * FROM moods WHERE date = ?")
        .map_err(|e: rusqlite::Error| format!("准备查询语句失败: {}", e))?;
    
    stmt.query_row(params![mood.date], Mood::from_row)
        .map_err(|e: rusqlite::Error| format!("查询新心情失败: {}", e))
}

// 删除心情记录
#[tauri::command]
pub fn delete_mood(state: State<AppState>, id: i64) -> Result<usize, String> {
    let conn = get_conn(&state)?;
    
    let rows_affected = conn
        .execute("DELETE FROM moods WHERE id = ?", params![id])
        .map_err(|e: rusqlite::Error| format!("删除心情失败: {}", e))?;
    
    Ok(rows_affected)
}