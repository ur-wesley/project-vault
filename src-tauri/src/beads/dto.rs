use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct BeadDependencyDto {
    pub issue_id: String,
    pub depends_on_id: String,
    #[serde(rename = "type")]
    pub dep_type: String,
    pub created_at: Option<String>,
    pub created_by: Option<String>,
    pub metadata: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct BeadIssueDto {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub priority: i32,
    pub issue_type: String,
    pub owner: Option<String>,
    pub assignee: Option<String>,
    pub is_blocked: Option<bool>,
    pub created_at: Option<String>,
    pub created_by: Option<String>,
    pub updated_at: Option<String>,
    pub started_at: Option<String>,
    pub closed_at: Option<String>,
    pub close_reason: Option<String>,
    pub parent: Option<String>,
    #[serde(default)]
    pub dependencies: Vec<BeadDependencyDto>,
    pub dependency_count: Option<usize>,
    pub dependent_count: Option<usize>,
    pub comment_count: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct BeadCommentDto {
    pub id: Option<String>,
    pub issue_id: Option<String>,
    pub author: Option<String>,
    pub text: String,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BeadsStatusDto {
    pub installed: bool,
    pub initialized: bool,
    pub version: Option<String>,
    pub issue_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBeadInput {
    pub project_path: String,
    pub title: String,
    pub issue_type: String,
    pub priority: i32,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBeadStatusInput {
    pub project_path: String,
    pub id: String,
    pub status: String,
    pub close_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddBeadCommentInput {
    pub project_path: String,
    pub id: String,
    pub comment: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deserialize_bd_issue_json() {
        let json = r#"[
            {
                "id": "test-1",
                "title": "Test Issue",
                "status": "open",
                "priority": 1,
                "issue_type": "task",
                "created_at": "2026-09-29T15:35:14Z",
                "comment_count": 3,
                "dependencies": [
                    {
                        "issue_id": "test-1",
                        "depends_on_id": "test-parent",
                        "type": "parent-child"
                    }
                ]
            }
        ]"#;

        let issues: Vec<BeadIssueDto> = serde_json::from_str(json).expect("should parse");
        assert_eq!(issues.len(), 1);
        let first = &issues[0];
        assert_eq!(first.id, "test-1");
        assert_eq!(first.issue_type, "task");
        assert_eq!(first.comment_count, Some(3));
        assert_eq!(first.dependencies.len(), 1);
        assert_eq!(first.dependencies[0].depends_on_id, "test-parent");

        let serialized = serde_json::to_string(first).expect("should serialize");
        assert!(serialized.contains(r#""issueType":"task""#));
        assert!(serialized.contains(r#""commentCount":3"#));
        assert!(serialized.contains(r#""dependsOnId":"test-parent""#));
    }

    #[test]
    fn test_deserialize_bd_comment_json() {
        let json = r#"[
            {
                "id": "comm-1",
                "issue_id": "test-1",
                "author": "ur-wesley",
                "text": "Hello world",
                "created_at": "2026-09-30T11:47:37Z"
            }
        ]"#;

        let comments: Vec<BeadCommentDto> = serde_json::from_str(json).expect("should parse");
        assert_eq!(comments.len(), 1);
        let comm = &comments[0];
        assert_eq!(comm.author.as_deref(), Some("ur-wesley"));

        let serialized = serde_json::to_string(comm).expect("should serialize");
        assert!(serialized.contains(r#""issueId":"test-1""#));
        assert!(serialized.contains(r#""createdAt":"2026-09-30T11:47:37Z""#));
    }
}

