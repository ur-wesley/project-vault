use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Issue {
    pub id: Option<i64>,
    pub number: i64,
    pub title: String,
    pub body: Option<String>,
    pub state: String, // "open", "closed"
    pub tags: Vec<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub closed_at_ms: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CreateIssueInput {
    pub title: String,
    pub body: Option<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UpdateIssueInput {
    pub title: Option<String>,
    pub body: Option<String>,
    pub state: Option<String>,
    pub tags: Option<Vec<String>>,
}
