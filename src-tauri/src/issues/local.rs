use async_trait::async_trait;
use sqlx::{Pool, Sqlite};
use crate::error::{StableError, codes, Result};
use super::models::{Issue, CreateIssueInput, UpdateIssueInput};
use super::provider::IssueProvider;
use crate::db::now_ms;

#[derive(sqlx::FromRow)]
struct IssueRow {
    id: i64,
    number: i64,
    title: String,
    body: Option<String>,
    state: String,
    tags: Option<String>,
    created_at_ms: i64,
    updated_at_ms: i64,
    closed_at_ms: Option<i64>,
}

fn row_to_issue(r: IssueRow) -> Issue {
    Issue {
        id: Some(r.id),
        number: r.number,
        title: r.title,
        body: r.body,
        state: r.state,
        tags: serde_json::from_str(&r.tags.unwrap_or_else(|| "[]".to_string())).unwrap_or_default(),
        created_at_ms: r.created_at_ms,
        updated_at_ms: r.updated_at_ms,
        closed_at_ms: r.closed_at_ms,
    }
}

pub struct LocalSqliteProvider {
    pool: Pool<Sqlite>,
}

impl LocalSqliteProvider {
    pub fn new(pool: Pool<Sqlite>) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl IssueProvider for LocalSqliteProvider {
    async fn list_issues(&self, project_id: &str) -> Result<Vec<Issue>> {
        println!("[LocalSqliteProvider] Listing issues for project: {}", project_id);
        let rows: Vec<IssueRow> = sqlx::query_as(
            "SELECT id, number, title, body, state, tags, created_at_ms, updated_at_ms, closed_at_ms FROM issues WHERE project_id = ?1 ORDER BY number DESC",
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;

        println!("[LocalSqliteProvider] Found {} local issues", rows.len());
        Ok(rows.into_iter().map(row_to_issue).collect())
    }

    async fn get_issue(&self, project_id: &str, number: i64) -> Result<Issue> {
        let row: Option<IssueRow> = sqlx::query_as(
            "SELECT id, number, title, body, state, tags, created_at_ms, updated_at_ms, closed_at_ms FROM issues WHERE project_id = ?1 AND number = ?2",
        )
        .bind(project_id)
        .bind(number)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;

        match row {
            Some(r) => Ok(row_to_issue(r)),
            None => Err(StableError::new(codes::NOT_FOUND, format!("Issue #{} not found", number))),
        }
    }

    async fn create_issue(&self, project_id: &str, input: CreateIssueInput) -> Result<Issue> {
        let mut tx = self.pool.begin().await.map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;

        // Get next number
        let next_number: i64 = sqlx::query_scalar(
            "INSERT INTO project_issue_counters (project_id, next_number) VALUES (?1, 2) 
             ON CONFLICT(project_id) DO UPDATE SET next_number = next_number + 1
             RETURNING next_number - 1",
        )
        .bind(project_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;

        let now = now_ms();
        let tags_json = serde_json::to_string(&input.tags).unwrap_or_else(|_| "[]".to_string());

        let id: i64 = sqlx::query_scalar(
            "INSERT INTO issues (project_id, number, title, body, tags, created_at_ms, updated_at_ms) 
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id",
        )
        .bind(project_id)
        .bind(next_number)
        .bind(&input.title)
        .bind(&input.body)
        .bind(&tags_json)
        .bind(now)
        .bind(now)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;

        tx.commit().await.map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;

        Ok(Issue {
            id: Some(id),
            number: next_number,
            title: input.title,
            body: input.body,
            state: "open".to_string(),
            tags: input.tags,
            created_at_ms: now,
            updated_at_ms: now,
            closed_at_ms: None,
        })
    }

    async fn update_issue(&self, project_id: &str, number: i64, input: UpdateIssueInput) -> Result<Issue> {
        let now = now_ms();
        
        let mut query = String::from("UPDATE issues SET updated_at_ms = ?1");
        let mut arg_count = 1;

        if input.title.is_some() {
            arg_count += 1;
            query.push_str(&format!(", title = ?{}", arg_count));
        }
        if input.body.is_some() {
            arg_count += 1;
            query.push_str(&format!(", body = ?{}", arg_count));
        }
        if let Some(state) = &input.state {
            arg_count += 1;
            query.push_str(&format!(", state = ?{}", arg_count));
            if state == "closed" {
                query.push_str(", closed_at_ms = COALESCE(closed_at_ms, ?1)");
            } else {
                query.push_str(", closed_at_ms = NULL");
            }
        }
        if input.tags.is_some() {
            arg_count += 1;
            query.push_str(&format!(", tags = ?{}", arg_count));
        }

        arg_count += 1;
        query.push_str(&format!(" WHERE project_id = ?{} AND number = ?{}", arg_count, arg_count + 1));

        let mut q = sqlx::query(&query).bind(now);
        if let Some(title) = input.title { q = q.bind(title); }
        if let Some(body) = input.body { q = q.bind(body); }
        if let Some(state) = input.state { q = q.bind(state); }
        if let Some(tags) = input.tags { 
            let tags_json = serde_json::to_string(&tags).unwrap_or_else(|_| "[]".to_string());
            q = q.bind(tags_json); 
        }
        q = q.bind(project_id);
        q = q.bind(number);

        let res = q.execute(&self.pool).await.map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
        if res.rows_affected() == 0 {
            return Err(StableError::new(codes::NOT_FOUND, format!("Issue #{} not found", number)));
        }

        self.get_issue(project_id, number).await
    }

    async fn delete_issue(&self, project_id: &str, number: i64) -> Result<()> {
        let res = sqlx::query(
            "DELETE FROM issues WHERE project_id = ?1 AND number = ?2",
        )
        .bind(project_id)
        .bind(number)
        .execute(&self.pool)
        .await
        .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;

        if res.rows_affected() == 0 {
            return Err(StableError::new(codes::NOT_FOUND, format!("Issue #{} not found", number)));
        }

        Ok(())
    }

    async fn delete_all_issues(&self, project_id: &str) -> Result<()> {
        sqlx::query(
            "DELETE FROM issues WHERE project_id = ?1",
        )
        .bind(project_id)
        .execute(&self.pool)
        .await
        .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;

        sqlx::query(
            "DELETE FROM project_issue_counters WHERE project_id = ?1",
        )
        .bind(project_id)
        .execute(&self.pool)
        .await
        .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;

        Ok(())
    }
}
