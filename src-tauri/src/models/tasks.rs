use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConcurrentTask {
    pub label: String,
    pub argv: Vec<String>,
    pub cwd: Option<String>,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDto {
    pub id: String,
    pub label: String,
    pub argv: Vec<String>,
    pub kind: String,
    pub cwd: Option<String>,
    pub description: Option<String>,
    pub depends: Vec<String>,
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub concurrent: Option<Vec<ConcurrentTask>>,
}


