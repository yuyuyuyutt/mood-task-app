// src/database.rs
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::Row;
use serde::{Deserialize, Serialize};
use tauri::Manager;

/// 数据库连接池类型别名
pub type DbPool = Pool<SqliteConnectionManager>;

/// 初始化数据库（建库 → 建表 → 顺序迁移）
pub fn init_db(app_handle: &tauri::AppHandle) -> Result<DbPool, String> {
    // 使用 Tauri 2.0 的正确API获取本地数据目录
    let app_data_dir = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("无法获取本地数据目录: {}", e))?;

    std::fs::create_dir_all(&app_data_dir).map_err(|e| format!("创建目录失败: {}", e))?;

    let db_path = app_data_dir.join("data.db");
    println!("数据库路径: {:?}", db_path);

    // 创建连接池
    let manager = SqliteConnectionManager::file(db_path);
    let pool = Pool::new(manager).map_err(|e: r2d2::Error| format!("创建连接池失败: {}", e))?;

    let mut conn = pool
        .get()
        .map_err(|e: r2d2::Error| format!("获取连接失败: {}", e))?;

    init_tables(&conn)?;
    migrate(&mut conn)?;

    Ok(pool)
}

fn init_tables(conn: &rusqlite::Connection) -> Result<(), String> {
    // 任务表（新库直接建到最新结构；旧库的增量变更由 migrate() 负责）
    conn.execute(
        "CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed')),
            priority INTEGER DEFAULT 2 CHECK(priority BETWEEN 1 AND 3),
            energy_cost INTEGER CHECK(energy_cost BETWEEN 1 AND 10),
            estimated_time INTEGER,
            actual_time INTEGER,
            due_date TEXT,
            completed_at TEXT,
            tags TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            -- 习惯任务字段
            is_habit BOOLEAN DEFAULT 0,
            habit_period TEXT CHECK(habit_period IN ('daily', 'weekdays', 'weekends', 'custom')),
            habit_completions TEXT, -- JSON格式存储完成记录
            habit_start_date TEXT,
            habit_end_date TEXT,
            updated_at TEXT
        )",
        [],
    )
    .map_err(|e: rusqlite::Error| format!("创建任务表失败: {}", e))?;

    // 【遗留表】心情数据已收敛到插件命名空间（plugin_data: namespace='mood',
    // collection='entries'）。此表只在 v1 迁移中作为数据源读取，之后不再写入。
    conn.execute(
        "CREATE TABLE IF NOT EXISTS moods (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL UNIQUE,
            mood_score INTEGER NOT NULL CHECK(mood_score BETWEEN 1 AND 5),
            mood_emoji TEXT NOT NULL,
            content TEXT NOT NULL,
            tags TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )
    .map_err(|e: rusqlite::Error| format!("创建心情表失败: {}", e))?;

    // 插件命名空间数据表（插件长期数据：按 namespace/collection 隔离）
    conn.execute(
        "CREATE TABLE IF NOT EXISTS plugin_data (
            namespace TEXT NOT NULL,
            collection TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (namespace, collection, key)
        )",
        [],
    )
    .map_err(|e: rusqlite::Error| format!("创建插件数据表失败: {}", e))?;

    // 索引
    for stmt in [
        "CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)",
        "CREATE INDEX IF NOT EXISTS idx_tasks_is_habit ON tasks(is_habit)",
        "CREATE INDEX IF NOT EXISTS idx_moods_date ON moods(date DESC)",
    ] {
        conn.execute(stmt, [])
            .map_err(|e: rusqlite::Error| format!("创建索引失败: {}", e))?;
    }

    Ok(())
}

// ---------------- 迁移（PRAGMA user_version 驱动） ----------------

/// 一条顺序迁移。`guard` 用于兼容"新库的 CREATE TABLE 已包含该列"的情况：
/// 当 guard 中的列已存在时跳过执行（user_version 仍会推进）。
struct Migration {
    sql: &'static str,
    guard: Option<(&'static str, &'static str)>,
}

/// 迁移表：**只允许在末尾追加**，绝不修改已发布的历史条目。
const MIGRATIONS: &[Migration] = &[
    // v0 -> v1：任务表补 updated_at（patch_task 与乐观排查依赖它）
    Migration {
        sql: "ALTER TABLE tasks ADD COLUMN updated_at TEXT",
        guard: Some(("tasks", "updated_at")),
    },
    // v1 -> v2：心情数据一次性收敛到插件命名空间；旧表保留但不再读写
    Migration {
        sql: "INSERT OR IGNORE INTO plugin_data (namespace, collection, key, value, updated_at)
              SELECT 'mood', 'entries', date,
                     json_object(
                       'mood_score', mood_score,
                       'mood_emoji', mood_emoji,
                       'content', content,
                       'tags', json(COALESCE(NULLIF(tags, ''), '[]')),
                       'created_at', COALESCE(created_at, datetime('now'))
                     ),
                     COALESCE(created_at, datetime('now'))
              FROM moods",
        guard: None,
    },
];

/// 按 PRAGMA user_version 顺序执行未应用的迁移（可重复调用，幂等）
pub fn migrate(conn: &mut rusqlite::Connection) -> Result<(), String> {
    let current: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| format!("读取 user_version 失败: {}", e))?;
    let current = current.max(0) as usize;
    if current >= MIGRATIONS.len() {
        return Ok(());
    }

    for (index, migration) in MIGRATIONS.iter().enumerate().skip(current) {
        let skip = match migration.guard {
            Some((table, column)) => has_column(conn, table, column)?,
            None => false,
        };
        if !skip {
            conn.execute(migration.sql, [])
                .map_err(|e| format!("迁移 #{} 执行失败: {}", index + 1, e))?;
        }
        conn.pragma_update(None, "user_version", (index + 1) as i64)
            .map_err(|e| format!("写入 user_version 失败: {}", e))?;
    }
    println!("数据库迁移完成：v{} -> v{}", current, MIGRATIONS.len());
    Ok(())
}

fn has_column(conn: &rusqlite::Connection, table: &str, column: &str) -> Result<bool, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({})", table))
        .map_err(|e| format!("读取表结构失败: {}", e))?;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let name: String = row.get(1).map_err(|e| e.to_string())?;
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

// 任务结构体
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Task {
    pub id: i64,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub priority: i64,
    pub energy_cost: Option<i64>,
    pub estimated_time: Option<i64>,
    pub actual_time: Option<i64>,
    pub due_date: Option<String>,
    pub completed_at: Option<String>,
    pub tags: Option<String>,
    pub created_at: String,
    // 习惯任务字段
    pub is_habit: Option<bool>,
    pub habit_period: Option<String>,
    pub habit_completions: Option<String>, // JSON字符串存储完成记录
    pub habit_start_date: Option<String>,
    pub habit_end_date: Option<String>,
    pub updated_at: Option<String>,
}

// 用于创建任务的数据结构
#[derive(Debug, Deserialize)]
pub struct CreateTask {
    pub title: String,
    pub description: Option<String>,
    pub status: Option<String>,
    pub priority: Option<i64>,
    pub energy_cost: Option<i64>,
    pub estimated_time: Option<i64>,
    pub actual_time: Option<i64>,
    pub due_date: Option<String>,
    pub completed_at: Option<String>,
    pub tags: Option<String>,
    // 习惯任务字段
    pub is_habit: Option<bool>,
    pub habit_period: Option<String>,
    pub habit_completions: Option<String>,
    pub habit_start_date: Option<String>,
    pub habit_end_date: Option<String>,
}

// 数据库行到结构体的转换（顺序必须与 tasks 表列顺序一致）
impl Task {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Task {
            id: row.get(0)?,
            title: row.get(1)?,
            description: row.get(2)?,
            status: row.get(3)?,
            priority: row.get(4)?,
            energy_cost: row.get(5)?,
            estimated_time: row.get(6)?,
            actual_time: row.get(7)?,
            due_date: row.get(8)?,
            completed_at: row.get(9)?,
            tags: row.get(10)?,
            created_at: row.get(11)?,
            is_habit: row.get(12).unwrap_or(Some(false)),
            habit_period: row.get(13)?,
            habit_completions: row.get(14)?,
            habit_start_date: row.get(15)?,
            habit_end_date: row.get(16)?,
            updated_at: row.get(17)?,
        })
    }
}
