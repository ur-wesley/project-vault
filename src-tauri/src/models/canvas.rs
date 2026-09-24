use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewportDto {
    pub pan_x: f64,
    pub pan_y: f64,
    pub zoom: f64,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasNodeDto {
    pub id: String,
    pub node_type: String,
    pub title: String,
    pub x: f64,
    pub y: f64,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub is_pinned: Option<bool>,
    pub data_json: Option<String>,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasWireDto {
    pub id: String,
    pub source_id: String,
    pub target_id: String,
    pub wire_type: Option<String>,
    pub status: Option<String>,
    pub annotation: Option<String>,
    pub rule_id: Option<String>,
    pub action_command: Option<String>,
    pub action_label: Option<String>,
    /// "assoc" = visual link, "data" = functional dataflow edge. Absent = "assoc".
    #[serde(default)]
    pub kind: Option<String>,
    /// Named output port on the source node (data wires only).
    #[serde(default)]
    pub source_port: Option<String>,
    /// Named input port on the target node (data wires only).
    #[serde(default)]
    pub target_port: Option<String>,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasBlueprintDto {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub app_scope: String,
    pub layout_json: String,
    pub is_builtin: bool,
    pub created_at_ms: i64,
}

/// Node types retired in favor of live-data nodes (v2 cleanup).
/// "issue" was a hardcoded mock (static PV-104 content, no backend) - removed.
pub const RETIRED_CANVAS_NODE_TYPES: &[&str] = &["ci", "deploy", "docker", "issue"];

/// Node types registered by the frontend node registry (defineNode).
pub const KNOWN_CANVAS_NODE_TYPES: &[&str] = &[
    "git",
    "task",
    "notes",
    "terminal",
    "filePreview",
    "webPreview",
    "webTools",
    "github-actions",
    "dokploy",
];


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasProjectLayoutDto {
    pub project_id: String,
    pub blueprint_id: Option<String>,
    pub layout_mode: String,
    pub viewport: ViewportDto,
    pub nodes: Vec<CanvasNodeDto>,
    pub wires: Vec<CanvasWireDto>,
    pub updated_at_ms: i64,
    #[serde(default)]
    pub schema_version: Option<i32>,
}



impl CanvasProjectLayoutDto {
    /// Breaking v2 validation: rejects absurd payloads before they hit SQLite.
    pub fn validate(&self) -> Result<(), crate::error::StableError> {
        use crate::error::StableError;
        if self.project_id.trim().is_empty() {
            return Err(StableError::new("INVALID_LAYOUT", "missing project_id"));
        }
        if self.nodes.len() > 200 {
            return Err(StableError::new(
                "INVALID_LAYOUT",
                "too many nodes (max 200)",
            ));
        }
        if self.wires.len() > 400 {
            return Err(StableError::new(
                "INVALID_LAYOUT",
                "too many wires (max 400)",
            ));
        }
        for n in &self.nodes {
            if n.id.trim().is_empty() || n.title.len() > 80 {
                return Err(StableError::new("INVALID_LAYOUT", "invalid node id/title"));
            }
            if !n.title.chars().all(|c| !c.is_control()) {
                return Err(StableError::new("INVALID_LAYOUT", "invalid node title"));
            }
        }
        Ok(())
    }

    /// Strips retired static nodes + dangling wires (idempotent).
    pub fn migrated(mut self) -> Self {
        let doomed: std::collections::HashSet<String> = self
            .nodes
            .iter()
            .filter(|n| RETIRED_CANVAS_NODE_TYPES.contains(&n.node_type.as_str()))
            .map(|n| n.id.clone())
            .collect();
        if doomed.is_empty() {
            return self;
        }
        self.nodes.retain(|n| !doomed.contains(&n.id));
        self.wires
            .retain(|w| !doomed.contains(&w.source_id) && !doomed.contains(&w.target_id));
        self
    }
}
