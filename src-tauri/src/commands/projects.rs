use serde::Deserialize;
use tauri::AppHandle;
use tauri::Emitter;
use tauri::State;
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::error::StableError;
use crate::models::{MoveProjectProgress, MoveProjectResultDto, ProjectDto, MiseToolDto};
use crate::project_move;

#[tauri::command]
pub async fn get_project_mise_tools(
    db: State<'_, DbInstances>,
    project_id: String,
) -> Result<Vec<MiseToolDto>, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &project_id).await?;
    let root = std::path::Path::new(&project.path);

    if !root.is_dir() {
        return Ok(Vec::new());
    }

    let output = std::process::Command::new("mise")
        .args(["ls", "--json"])
        .current_dir(root)
        .output();

    let Ok(out) = output else {
        return Ok(Vec::new());
    };

    if !out.status.success() {
        return Ok(Vec::new());
    }

    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap_or(serde_json::Value::Null);
    let mut tools = Vec::new();

    if let Some(obj) = v.as_object() {
        for (name, versions) in obj {
            if let Some(arr) = versions.as_array() {
                for item in arr {
                    let version = item.get("version").and_then(|v| v.as_str()).unwrap_or("unknown");
                    let source = item.get("source").and_then(|v| v.get("path")).and_then(|p| p.as_str()).unwrap_or("unknown");
                    let active = item.get("active").and_then(|v| v.as_bool()).unwrap_or(false);
                    
                    if active {
                        tools.push(MiseToolDto {
                            name: name.clone(),
                            version: version.to_string(),
                            source: source.to_string(),
                            is_active: true,
                        });
                    }
                }
            }
        }
    }

    Ok(tools)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetFavoritePayload {
    pub id: String,
    pub favorite: bool,
}

#[tauri::command]
pub async fn list_projects(db: State<'_, DbInstances>) -> Result<Vec<ProjectDto>, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    db::list_projects(&pool).await
}

#[tauri::command]
pub async fn get_project(
    db: State<'_, DbInstances>,
    id: String,
) -> Result<ProjectDto, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    db::get_project(&pool, &id).await
}

#[tauri::command]
pub async fn delete_project(db: State<'_, DbInstances>, id: String) -> Result<(), StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    db::delete_project(&pool, &id).await
}

#[tauri::command]
pub async fn set_project_favorite(
    db: State<'_, DbInstances>,
    payload: SetFavoritePayload,
) -> Result<ProjectDto, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    db::set_project_favorite(&pool, &payload.id, payload.favorite).await
}

#[tauri::command]
pub async fn touch_project_opened(
    db: State<'_, DbInstances>,
    id: String,
) -> Result<ProjectDto, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    db::touch_project_opened(&pool, &id).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveProjectPayload {
    pub project_id: String,
    pub destination_parent: String,
}

use std::collections::HashMap;

#[tauri::command]
pub async fn get_project_languages(
    db: State<'_, DbInstances>,
    project_id: String,
) -> Result<HashMap<String, u64>, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &project_id).await?;
    let root = std::path::Path::new(&project.path);

    if !root.is_dir() {
        return Ok(HashMap::new());
    }

    let mut stats = HashMap::new();
    let mut stack = vec![root.to_path_buf()];
    let mut files_processed = 0;

    // Limits to avoid hanging on massive folders
    const MAX_FILES: usize = 10_000;
    const IGNORED: &[&str] = &[
        "node_modules",
        ".git",
        "dist",
        "build",
        "target",
        "vendor",
        ".next",
        ".nuxt",
        "venv",
        ".venv",
        "__pycache__",
        "obj",
        "bin",
    ];

    while let Some(dir) = stack.pop() {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let name = entry.file_name();
                let name_str = name.to_string_lossy();

                if IGNORED.contains(&name_str.as_ref()) {
                    continue;
                }

                if path.is_dir() {
                    stack.push(path);
                } else if path.is_file() {
                    files_processed += 1;
                    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                        let count = stats.entry(ext.to_lowercase()).or_insert(0);
                        *count += 1;
                    }
                    if files_processed >= MAX_FILES {
                        break;
                    }
                }
            }
        }
        if files_processed >= MAX_FILES {
            break;
        }
    }

    Ok(stats)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProjectPayload {
    pub source_path: String,
    pub destination_location_id: String,
    pub delete_source: bool,
}

#[tauri::command]
pub async fn import_project(
    app: AppHandle,
    db: State<'_, DbInstances>,
    payload: ImportProjectPayload,
) -> Result<(), StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    
    // 1. Resolve source and destination
    let src = std::path::PathBuf::from(&payload.source_path);
    if !src.is_dir() {
        return Err(StableError::new(crate::error::codes::INVALID_PATH, "source is not a directory"));
    }
    let src = dunce::canonicalize(&src).map_err(|e| StableError::new(crate::error::codes::INVALID_PATH, format!("invalid source path: {e}")))?;

    let location = db::get_location(&pool, &payload.destination_location_id).await?;
    let dest_parent = std::path::Path::new(&location.path);
    if !dest_parent.is_dir() {
        return Err(StableError::new(crate::error::codes::INVALID_PATH, "destination library folder is missing or not a directory"));
    }

    let folder_name = src.file_name().ok_or_else(|| StableError::new(crate::error::codes::INVALID_PATH, "invalid source folder name"))?;
    let dest = dest_parent.join(folder_name);
    
    if dest.exists() {
        return Err(StableError::new(crate::error::codes::ALREADY_EXISTS, "a folder with that name already exists in the destination location"));
    }

    // 2. Perform copy with progress
    let temp_id = uuid::Uuid::new_v4().to_string();
    let app_b = app.clone();
    let src_b = src.clone();
    let dest_b = dest.clone();
    let tid = temp_id.clone();
    
    tauri::async_runtime::spawn_blocking(move || {
        let mut f = |prog: MoveProjectProgress| {
            let _ = app_b.emit("import-project-progress", prog);
        };
        project_move::run_copy_and_verify(&tid, &src_b, &dest_b, &mut f)
    })
    .await
    .map_err(|e| StableError::new(crate::error::codes::INTERNAL, e.to_string()))??;

    // 3. Optional cleanup
    if payload.delete_source {
        let _ = tauri::async_runtime::spawn_blocking(move || std::fs::remove_dir_all(&src)).await;
    }

    // 4. Trigger a scan of the location to pick up the new project
    crate::commands::scan::scan_library_location(db, payload.destination_location_id).await?;

    Ok(())
}

#[tauri::command]
pub async fn move_project(
    app: AppHandle,
    db: State<'_, DbInstances>,
    payload: MoveProjectPayload,
) -> Result<MoveProjectResultDto, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let p =
        project_move::prepare_move(&pool, &payload.project_id, &payload.destination_parent).await?;
    let from = p.source;
    let to = p.dest;
    let new_path = p.dest_path_string;
    let loc = p.location_id;
    let project_id = payload.project_id.clone();
    let app_b = app.clone();
    let (files_total, bytes_total) = tauri::async_runtime::spawn_blocking({
        let from_b = from.clone();
        let to_b = to;
        let pid = project_id.clone();
        let app_c = app_b.clone();
        move || {
            let mut f = |prog: MoveProjectProgress| {
                let _ = app_c.emit("move-project-progress", prog);
            };
            project_move::run_copy_and_verify(&pid, &from_b, &to_b, &mut f)
        }
    })
    .await
    .map_err(|e| StableError::new(crate::error::codes::INTERNAL, e.to_string()))??;
    let _ = app.emit(
        "move-project-progress",
        MoveProjectProgress {
            project_id: project_id.clone(),
            phase: "finalizing".to_string(),
            files_total,
            bytes_total,
            files_done: files_total,
            bytes_done: bytes_total,
        },
    );
    let out = project_move::update_after_move(&pool, &payload.project_id, &new_path, &loc).await?;
    let old_path_label = from.display().to_string();
    let cleanup_warning =
        match tauri::async_runtime::spawn_blocking(move || std::fs::remove_dir_all(&from)).await {
            Ok(Ok(())) => None,
            Ok(Err(e)) => Some(format!("{old_path_label} — {e}")),
            Err(e) => Some(format!("{old_path_label} (task: {e})")),
        };
    Ok(MoveProjectResultDto {
        project: out,
        cleanup_warning,
    })
}
