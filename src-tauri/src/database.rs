use serde::{Deserialize, Serialize};

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