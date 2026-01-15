// src/database.rs
use serde::{Deserialize, Serialize};
use rusqlite::Row; // 移除了未使用的 params 导入
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use tauri::Manager;

// 数据库连接池类型别名
pub type DbPool = Pool<SqliteConnectionManager>;

// 初始化数据库
pub fn init_db(app_handle: &tauri::AppHandle) -> Result<DbPool, String> {
    // 使用 Tauri 2.0 的正确API获取本地数据目录
    let app_data_dir = app_handle.path().app_local_data_dir()
        .map_err(|e| format!("无法获取本地数据目录: {}", e))?;
    
    std::fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("创建目录失败: {}", e))?;
    
    let db_path = app_data_dir.join("data.db");
    println!("数据库路径: {:?}", db_path);
    
    // 创建连接池
    let manager = SqliteConnectionManager::file(db_path);
    let pool = Pool::new(manager)
        .map_err(|e: r2d2::Error| format!("创建连接池失败: {}", e))?;
    
    // 初始化表结构
    init_tables(&pool)?;
    
    Ok(pool)
}

fn init_tables(pool: &DbPool) -> Result<(), String> {
    let conn = pool.get()
        .map_err(|e: r2d2::Error| format!("获取连接失败: {}", e))?;
    
    // 任务表
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
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    ).map_err(|e: rusqlite::Error| format!("创建任务表失败: {}", e))?;
    
    // 心情日记表
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
    ).map_err(|e: rusqlite::Error| format!("创建心情表失败: {}", e))?;
    
    // 创建索引
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)",
        [],
    ).map_err(|e: rusqlite::Error| format!("创建索引失败: {}", e))?;
    
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_moods_date ON moods(date DESC)",
        [],
    ).map_err(|e: rusqlite::Error| format!("创建索引失败: {}", e))?;
    
    Ok(())
}

// 原有的结构体保持不变
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
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Mood {
    pub id: i64,
    pub date: String,
    pub mood_score: i64,
    pub mood_emoji: String,
    pub content: String,
    pub tags: Option<String>,
    pub created_at: String,
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
    pub tags: Option<String>,
}

// 用于创建心情的数据结构
#[derive(Debug, Deserialize)]
pub struct CreateMood {
    pub date: String,
    pub mood_score: i64,
    pub mood_emoji: String,
    pub content: String,
    pub tags: Option<String>,
}

// 数据库行到结构体的转换
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
        })
    }
}

impl Mood {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Mood {
            id: row.get(0)?,
            date: row.get(1)?,
            mood_score: row.get(2)?,
            mood_emoji: row.get(3)?,
            content: row.get(4)?,
            tags: row.get(5)?,
            created_at: row.get(6)?,
        })
    }
}