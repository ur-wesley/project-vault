use crate::error::Result;
use super::models::{Issue, CreateIssueInput, UpdateIssueInput};
use super::provider::IssueProvider;
use super::local::LocalSqliteProvider;
use sqlx::{Pool, Sqlite};

pub struct IssueManager {
    provider: Box<dyn IssueProvider>,
}

impl IssueManager {
    pub async fn new(pool: Pool<Sqlite>, project_id: &str) -> Result<Self> {
        // Try to detect if this is a GitHub project
        let _project = crate::db::get_project(&pool, project_id).await?;
        
        // For now, we default to LocalSqliteProvider. 
        // In the future, this is where we'd check project.github_owner / github_repo
        // and return a GitHubProvider if configured.
        
        Ok(Self {
            provider: Box::new(LocalSqliteProvider::new(pool)),
        })
    }

    pub async fn list_issues(&self, project_id: &str) -> Result<Vec<Issue>> {
        self.provider.list_issues(project_id).await
    }

    pub async fn get_issue(&self, project_id: &str, number: i64) -> Result<Issue> {
        self.provider.get_issue(project_id, number).await
    }

    pub async fn create_issue(&self, project_id: &str, input: CreateIssueInput) -> Result<Issue> {
        self.provider.create_issue(project_id, input).await
    }

    pub async fn update_issue(&self, project_id: &str, number: i64, input: UpdateIssueInput) -> Result<Issue> {
        self.provider.update_issue(project_id, number, input).await
    }

    pub async fn delete_issue(&self, project_id: &str, number: i64) -> Result<()> {
        self.provider.delete_issue(project_id, number).await
    }

    pub async fn delete_all_issues(&self, project_id: &str) -> Result<()> {
        self.provider.delete_all_issues(project_id).await
    }
}
