use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;
use crate::error::StableError;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputBoxOptions {
    pub title: String,
    pub placeholder: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickPickItem {
    pub id: String,
    pub label: String,
    pub detail: Option<String>,
    pub icon: Option<String>,
    pub file_path: Option<String>,
    pub line_number: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickPickOptions {
    pub title: String,
    pub items: Vec<QuickPickItem>,
    pub fuzzy: Option<bool>,
    pub preview: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormSelectOption {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormField {
    pub id: String,
    pub label: String,
    pub field_type: String, // "text" | "number" | "boolean" | "select" | "textarea"
    pub placeholder: Option<String>,
    pub default_value: Option<serde_json::Value>,
    pub options: Option<Vec<FormSelectOption>>,
    pub required: Option<bool>,
    pub pattern: Option<String>,
    pub validation_message: Option<String>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub step: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormOptions {
    pub title: String,
    pub fields: Vec<FormField>,
}

pub struct PendingUiResponse {
    pub tx: oneshot::Sender<serde_json::Value>,
}

#[derive(Clone)]
pub struct UiBridge {
    pub pending: Arc<Mutex<HashMap<String, PendingUiResponse>>>,
    pub active_project_id: Arc<Mutex<Option<String>>>,
}

impl Default for UiBridge {
    fn default() -> Self {
        Self {
            pending: Arc::new(Mutex::new(HashMap::new())),
            active_project_id: Arc::new(Mutex::new(None)),
        }
    }
}

impl UiBridge {
    pub fn register(&self, id: String, tx: oneshot::Sender<serde_json::Value>) {
        let mut guard = self.pending.lock().unwrap();
        guard.insert(id, PendingUiResponse { tx });
    }

    pub fn resolve(&self, id: &str, value: serde_json::Value) -> bool {
        let mut guard = self.pending.lock().unwrap();
        if let Some(pending) = guard.remove(id) {
            let _ = pending.tx.send(value);
            true
        } else {
            false
        }
    }

    pub fn set_active_project(&self, project_id: Option<String>) {
        let mut guard = self.active_project_id.lock().unwrap();
        *guard = project_id;
    }

    pub fn get_active_project(&self) -> Option<String> {
        let guard = self.active_project_id.lock().unwrap();
        guard.clone()
    }
}

pub async fn show_input_box(
    app: AppHandle,
    bridge: &UiBridge,
    options: InputBoxOptions,
) -> Result<Option<String>, StableError> {
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    let id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel();
    
    bridge.register(id.clone(), tx);
    
    app.emit("plugin:show-input", (id, options)).map_err(|e| StableError::new(crate::error::codes::INTERNAL, e.to_string()))?;
    
    let res = rx.await.map_err(|e| StableError::new(crate::error::codes::INTERNAL, e.to_string()))?;
    
    Ok(res.as_str().map(|s| s.to_string()))
}

pub async fn show_quick_pick(
    app: AppHandle,
    bridge: &UiBridge,
    options: QuickPickOptions,
) -> Result<Option<String>, StableError> {
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    let id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel();
    
    bridge.register(id.clone(), tx);
    
    app.emit("plugin:show-quick-pick", (id, options)).map_err(|e| StableError::new(crate::error::codes::INTERNAL, e.to_string()))?;
    
    let res = rx.await.map_err(|e| StableError::new(crate::error::codes::INTERNAL, e.to_string()))?;
    
    Ok(res.as_str().map(|s| s.to_string()))
}

pub async fn show_form(
    app: AppHandle,
    bridge: &UiBridge,
    options: FormOptions,
) -> Result<Option<serde_json::Value>, StableError> {
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    let id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel();

    bridge.register(id.clone(), tx);

    app.emit("plugin:show-form", (id, options)).map_err(|e| StableError::new(crate::error::codes::INTERNAL, e.to_string()))?;

    let res = rx.await.map_err(|e| StableError::new(crate::error::codes::INTERNAL, e.to_string()))?;

    if res.is_null() {
        Ok(None)
    } else {
        Ok(Some(res))
    }
}

#[tauri::command]
pub async fn resolve_plugin_ui(
    bridge: tauri::State<'_, UiBridge>,
    id: String,
    value: serde_json::Value,
) -> Result<(), StableError> {
    if bridge.resolve(&id, value) {
        Ok(())
    } else {
        Err(StableError::new(crate::error::codes::NOT_FOUND, "pending UI not found"))
    }
}

#[tauri::command]
pub async fn set_active_project(
    bridge: tauri::State<'_, UiBridge>,
    project_id: Option<String>,
) -> Result<(), StableError> {
    bridge.set_active_project(project_id);
    Ok(())
}
