use async_trait::async_trait;
use crate::error::Result;
use super::models::{Issue, CreateIssueInput, UpdateIssueInput};

#[async_trait]
pub trait IssueProvider: Send + Sync {
    async fn list_issues(&self, project_id: &str) -> Result<Vec<Issue>>;
    async fn get_issue(&self, project_id: &str, number: i64) -> Result<Issue>;
    async fn create_issue(&self, project_id: &str, input: CreateIssueInput) -> Result<Issue>;
    async fn update_issue(&self, project_id: &str, number: i64, input: UpdateIssueInput) -> Result<Issue>;
    async fn delete_issue(&self, project_id: &str, number: i64) -> Result<()>;
    async fn delete_all_issues(&self, project_id: &str) -> Result<()>;
}
