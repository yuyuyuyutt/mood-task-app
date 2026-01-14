mod database;

use database::{Task, Mood};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
struct GreetResponse {
    message: String,
}

// Tauri 命令
#[tauri::command]
fn greet(name: &str) -> GreetResponse {
    GreetResponse {
        message: format!("Hello, {}! You've been greeted from Rust!", name),
    }
}

#[tauri::command]
fn get_tasks() -> Vec<Task> {
    // 返回模拟数据
    vec![
        Task {
            id: 1,
            title: "Welcome to MoodTask".to_string(),
            description: Some("This is your first task".to_string()),
            status: "pending".to_string(),
            priority: 2,
            energy_cost: Some(3),
            estimated_time: Some(30),
            actual_time: None,
            due_date: None,
            completed_at: None,
            tags: Some("welcome,example".to_string()),
            created_at: chrono::Utc::now().to_rfc3339(),
        }
    ]
}

#[tauri::command]
fn save_mood(mood: Mood) -> Result<i64, String> {
    // 暂时返回模拟ID
    Ok(1)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            greet,
            get_tasks,
            save_mood,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}