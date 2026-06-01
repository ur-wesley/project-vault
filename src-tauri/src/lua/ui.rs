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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickPickOptions {
    pub title: String,
    pub items: Vec<QuickPickItem>,
}

pub struct PendingUiResponse {
    pub tx: oneshot::Sender<serde_json::Value>,
}

#[derive(Default, Clone)]
pub struct UiBridge(pub Arc<Mutex<HashMap<String, PendingUiResponse>>>);

impl UiBridge {
    pub fn register(&self, id: String, tx: oneshot::Sender<serde_json::Value>) {
        let mut guard = self.0.lock().unwrap();
        guard.insert(id, PendingUiResponse { tx });
    }

    pub fn resolve(&self, id: &str, value: serde_json::Value) -> bool {
        let mut guard = self.0.lock().unwrap();
        if let Some(pending) = guard.remove(id) {
            let _ = pending.tx.send(value);
            true
        } else {
            false
        }
    }
}

pub async fn show_input_box(
    app: AppHandle,
    bridge: &UiBridge,
    options: InputBoxOptions,
) -> Result<Option<String>, StableError> {
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
    let id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel();
    
    bridge.register(id.clone(), tx);
    
    app.emit("plugin:show-quick-pick", (id, options)).map_err(|e| StableError::new(crate::error::codes::INTERNAL, e.to_string()))?;
    
    let res = rx.await.map_err(|e| StableError::new(crate::error::codes::INTERNAL, e.to_string()))?;
    
    Ok(res.as_str().map(|s| s.to_string()))
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
