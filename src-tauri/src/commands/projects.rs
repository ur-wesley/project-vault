use serde::Deserialize;
use tauri::AppHandle;
use tauri::Emitter;
use tauri::State;
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::discovery::DetectorRegistry;
use crate::error::{codes, StableError};
use crate::spawn::task_monitor;
use crate::spawn::TaskMonitors;
use crate::models::{MoveProjectProgress, MoveProjectResultDto, ProjectDto, MiseToolDto, MiseToolSuggestionDto};
use crate::project_move;
use crate::mise_tools;

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

    let mut cmd = crate::process_util::hidden_command("mise");
    cmd.args(["ls", "--json"]).current_dir(root);
    let output = cmd.output();

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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteProjectPayload {
    pub id: String,
    pub delete_from_disk: bool,
}

#[tauri::command]
pub async fn delete_project(
    app: AppHandle,
    db: State<'_, DbInstances>,
    monitors: State<'_, TaskMonitors>,
    payload: DeleteProjectPayload,
) -> Result<(), StableError> {
    let pool = db::sqlite_pool(&*db).await?;

    if payload.delete_from_disk {
        // Stop all running tasks for this project so they release file handles
        let sessions_to_stop: Vec<String> = {
            let guard = monitors
                .0
                .lock()
                .map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?;
            guard
                .values()
                .filter(|entry| entry.project_id == payload.id && !entry.finished)
                .map(|entry| entry.session_id.clone())
                .collect()
        };
        for session_id in sessions_to_stop {
            let _ = task_monitor::request_stop(app.clone(), &*monitors, &session_id).await;
        }

        let project = db::get_project(&pool, &payload.id).await?;
        let path = std::path::Path::new(&project.path);
        if path.is_dir() {
            // Give the OS a moment to release handles after killing processes
            tokio::time::sleep(std::time::Duration::from_millis(800)).await;
            if let Err(_e) = std::fs::remove_dir_all(path) {
                // Retry once after a longer delay in case handles are slow to release
                tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
                std::fs::remove_dir_all(path).map_err(|e| {
                    StableError::new(
                        codes::INTERNAL,
                        format!(
                            "Could not delete project directory. \
                            Please close any IDE, terminal, or file explorer windows \
                            that have this project open, then try again. ({})",
                            e
                        ),
                    )
                })?;
            }
        } else if path.is_file() {
            std::fs::remove_file(path).map_err(|e| {
                StableError::new(
                    codes::INTERNAL,
                    format!(
                        "Could not delete project file. \
                        Please close any applications using this file, then try again. ({})",
                        e
                    ),
                )
            })?;
        }
    }

    db::delete_project(&pool, &payload.id).await
}

#[tauri::command]
pub async fn set_project_favorite(
    app: AppHandle,
    db: State<'_, DbInstances>,
    payload: SetFavoritePayload,
) -> Result<ProjectDto, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::set_project_favorite(&pool, &payload.id, payload.favorite).await?;
    crate::models::emit_project_changed(&app, &payload.id, "favorite");
    Ok(project)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTagPayload {
    pub id: String,
    pub tag: String,
}

#[tauri::command]
pub async fn set_project_tag(
    app: AppHandle,
    db: State<'_, DbInstances>,
    payload: SetTagPayload,
) -> Result<ProjectDto, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::set_project_tag(&pool, &payload.id, &payload.tag).await?;
    crate::models::emit_project_changed(&app, &payload.id, "tags");
    Ok(project)
}

#[tauri::command]
pub async fn remove_project_tag(
    app: AppHandle,
    db: State<'_, DbInstances>,
    payload: SetTagPayload,
) -> Result<ProjectDto, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::remove_project_tag(&pool, &payload.id, &payload.tag).await?;
    crate::models::emit_project_changed(&app, &payload.id, "tags");
    Ok(project)
}

#[tauri::command]
pub async fn touch_project_opened(
    app: AppHandle,
    db: State<'_, DbInstances>,
    id: String,
) -> Result<ProjectDto, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::touch_project_opened(&pool, &id).await?;
    crate::models::emit_project_changed(&app, &id, "opened");
    Ok(project)
}

#[tauri::command]
pub async fn refresh_project(
    app: AppHandle,
    db: State<'_, DbInstances>,
    project_id: String,
) -> Result<ProjectDto, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let existing = db::get_project(&pool, &project_id).await?;

    // Re-detect the project on disk
    let reg = DetectorRegistry::standard(crate::discovery::detectors_dir(&app));
    let draft = reg.detect(std::path::Path::new(&existing.path));

    let needs_update = draft.as_ref().map(|d| {
        let icon_path = crate::discovery::find_project_icon(&d.root);
        d.stack != existing.stack
            || d.name != existing.name
            || d.github_owner != existing.github_owner
            || d.github_repo != existing.github_repo
            || d.runtime_hint != existing.runtime_hint
            || d.tasks.len() != existing.tasks.len()
            || d.tags.len() != existing.tags.len()
            || icon_path != existing.icon_path
    }).unwrap_or(false);

    if needs_update {
        if let Some(d) = draft {
            let mut dto = existing.clone();
            dto.name = d.name;
            dto.stack = d.stack;
            dto.runtime_hint = d.runtime_hint;
            dto.github_owner = d.github_owner;
            dto.github_repo = d.github_repo;
            dto.tasks = d.tasks;
            dto.tags = d.tags;
            dto.icon_path = crate::discovery::find_project_icon(&d.root);
            db::upsert_project(&pool, &dto).await?;
            crate::models::emit_project_changed(&app, &project_id, "scan");
        }
    }

    // Always update last_opened_at_ms
    let updated = db::touch_project_opened(&pool, &project_id).await?;

    // Background: re-count file count and size_bytes
    let app_clone = app.clone();
    let path_clone = existing.path.clone();
    let pid_clone = project_id.clone();
    let pool_clone = pool.clone();
    tokio::task::spawn(async move {
        update_project_size(&app_clone, &pool_clone, &pid_clone, &path_clone).await;
    });

    Ok(updated)
}

pub async fn update_project_size(
    app: &AppHandle,
    pool: &sqlx::Pool<sqlx::Sqlite>,
    project_id: &str,
    path: &str,
) {
    if let Ok(stats) = project_move::count_filtered_dir(std::path::Path::new(path)) {
        if let Ok(existing) = db::get_project(pool, project_id).await {
            if stats.file_count != existing.file_count
                || stats.total_bytes != existing.size_bytes
                || stats.last_edited_at_ms != existing.last_edited_at_ms.unwrap_or(0)
            {
                let mut dto = existing.clone();
                dto.file_count = stats.file_count;
                dto.size_bytes = stats.total_bytes;
                dto.last_edited_at_ms = Some(stats.last_edited_at_ms);
                if db::upsert_project(pool, &dto).await.is_ok() {
                    crate::models::emit_project_changed(app, project_id, "scan");
                }
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveProjectPayload {
    pub project_id: String,
    pub destination_parent: String,
}

use std::collections::HashMap;

const IGNORED_EXTENSIONS: &[&str] = &[
    // Images
    "png", "jpg", "jpeg", "gif", "bmp", "tiff", "webp", "svg", "ico", "raw", "psd", "ai",
    // Videos
    "mp4", "mov", "avi", "mkv", "wmv", "flv", "webm", "m4v", "mpg", "mpeg", "3gp",
    // Audio
    "mp3", "wav", "flac", "aac", "ogg", "wma", "m4a", "opus",
    // Fonts
    "woff", "woff2", "ttf", "otf", "eot",
    // Archives / binaries
    "zip", "tar", "gz", "rar", "7z", "exe", "dll", "so", "dylib", "bin",
    // Documents
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp",
    // Config / data
    "json", "toml", "yaml", "yml", "xml", "ini", "cfg", "conf", "lock", "env", "properties",
    // Text / markup / data
    "md", "mdx", "markdown", "txt", "rtf", "log", "csv", "tsv",
];

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

    let ignored_set: std::collections::HashSet<&str> = IGNORED_EXTENSIONS.iter().copied().collect();
    let mut stats = HashMap::new();
    let mut files_processed = 0;
    const MAX_FILES: usize = 10_000;

    let walker = ignore::WalkBuilder::new(root)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .ignore(true)
        .build();

    for result in walker {
        let entry = match result {
            Ok(e) => e,
            Err(_) => continue,
        };

        if !entry.file_type().map_or(false, |ft| ft.is_file()) {
            continue;
        }

        let Some(ext) = entry.path().extension().and_then(|e| e.to_str()) else {
            continue;
        };
        let ext_lower = ext.to_lowercase();
        if ignored_set.contains(ext_lower.as_str()) {
            continue;
        }

        files_processed += 1;
        let count = stats.entry(ext_lower).or_insert(0);
        *count += 1;

        if files_processed >= MAX_FILES {
            break;
        }
    }

    Ok(stats)
}

#[tauri::command]
pub async fn suggest_mise_tools(
    db: State<'_, DbInstances>,
    project_id: String,
) -> Result<Vec<MiseToolSuggestionDto>, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &project_id).await?;
    let root = std::path::Path::new(&project.path);

    if !root.is_dir() {
        return Ok(Vec::new());
    }

    let suggestions = mise_tools::suggest_tools_for_project(
        root,
        &project.stack,
        project.runtime_hint.as_deref(),
    );

    Ok(suggestions)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinMiseToolsPayload {
    pub project_id: String,
    pub tools: Vec<MiseToolSuggestionDto>,
}

#[tauri::command]
pub async fn pin_mise_tools(
    db: State<'_, DbInstances>,
    payload: PinMiseToolsPayload,
) -> Result<(), StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &payload.project_id).await?;
    let root = std::path::Path::new(&project.path);

    if !root.is_dir() {
        return Err(StableError::new(
            crate::error::codes::INVALID_PATH,
            "project path is not a directory",
        ));
    }

    mise_tools::pin_tools_to_mise(root, &payload.tools)
        .map_err(|e| StableError::new(crate::error::codes::INTERNAL, e))?;

    Ok(())
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
    crate::commands::scan::scan_library_location(app, db, payload.destination_location_id).await?;

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
