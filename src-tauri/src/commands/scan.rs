use std::collections::HashSet;
use std::path::Path;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::discovery::{
    collect_projects_under_root, filter_workspaces_and_outermost, path_key, DetectorRegistry,
    ProjectDraft,
};
use crate::error::{codes, StableError};
use crate::models::{ProjectDto, ScanResultDto};
use crate::search::indexer::build_project_index;

fn registry() -> DetectorRegistry {
    DetectorRegistry::standard()
}

#[tauri::command]
pub fn debug_detect_project(path: String) -> Result<Option<ProjectDraft>, StableError> {
    let reg = registry();
    let root = Path::new(&path);
    if !root.is_dir() {
        return Err(StableError::new(codes::INVALID_PATH, "not a directory"));
    }
    let res = reg.detect(root);
    Ok(res)
}

#[derive(serde::Serialize)]
pub struct DebugScanResult {
    pub raw: Vec<ProjectDraft>,
    pub filtered: Vec<ProjectDraft>,
    pub monorepos_expanded: u64,
    pub workspace_warnings: u64,
}

#[tauri::command]
pub fn debug_scan_location(path: String) -> Result<DebugScanResult, StableError> {
    let reg = registry();
    let root = Path::new(&path);
    if !root.is_dir() {
        return Err(StableError::new(codes::INVALID_PATH, "not a directory"));
    }
    let mut dirs_skipped = 0u64;
    let raw = collect_projects_under_root(&reg, root, &mut dirs_skipped);
    let mut monorepos_expanded = 0u64;
    let mut workspace_warnings = 0u64;
    let filtered = filter_workspaces_and_outermost(&reg, raw.clone(), &mut monorepos_expanded, &mut workspace_warnings);
    Ok(DebugScanResult {
        raw,
        filtered,
        monorepos_expanded,
        workspace_warnings,
    })
}

#[tauri::command]
pub async fn scan_library_location(
    app: AppHandle,
    db: State<'_, DbInstances>,
    location_id: String,
) -> Result<ScanResultDto, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let loc = db::get_location(&pool, &location_id).await?;
    if !loc.enabled {
        return Err(StableError::new(
            codes::INVALID_PATH,
            "location is disabled",
        ));
    }
    let root = Path::new(&loc.path);
    if !root.is_dir() {
        return Err(StableError::new(
            codes::INVALID_PATH,
            "location path is not a directory",
        ));
    }
    let reg = registry();
    let mut dirs_skipped = 0u64;
    let raw = collect_projects_under_root(&reg, root, &mut dirs_skipped);
    let mut monorepos_expanded = 0u64;
    let mut workspace_warnings = 0u64;
    let drafts = filter_workspaces_and_outermost(&reg, raw, &mut monorepos_expanded, &mut workspace_warnings);
    let discovered = drafts.len() as u64;
    let mut keep = HashSet::new();
    let mut upserted = 0u64;
    let mut indexed_project_ids = Vec::new();
    for d in drafts {
        let key = path_key(&d.root);
        keep.insert(key.clone());

        let filtered_stats = crate::project_move::count_filtered_dir(&d.root).ok();
        let file_count = filtered_stats.map(|s| s.file_count).unwrap_or(0);
        let last_edited_at_ms = filtered_stats.and_then(|s| if s.last_edited_at_ms > 0 { Some(s.last_edited_at_ms) } else { None });
        let size_bytes = crate::project_move::count_all_dir(&d.root).map(|(_, total)| total).unwrap_or(0);

        let dto = ProjectDto {
            id: String::new(),
            location_id: location_id.clone(),
            name: d.name,
            path: key,
            stack: d.stack,
            runtime_hint: d.runtime_hint,
            favorite: false,
            last_opened_at_ms: None,
            total_playtime_ms: 0,
            tasks: d.tasks,
            tags: d.tags,
            github_owner: d.github_owner,
            github_repo: d.github_repo,
            file_count,
            size_bytes,
            last_edited_at_ms,
        };
        let project = db::upsert_project(&pool, &dto).await?;
        upserted += 1;
        indexed_project_ids.push((project.id, d.root));
    }

    // Auto-index discovered projects if setting is enabled
    let auto_index = db::get_setting(&pool, "auto_index_projects").await.ok().flatten().unwrap_or_default() != "false";
    if auto_index {
        let app_data_dir = app.path().app_data_dir().map_err(|e| {
            StableError::new(codes::INTERNAL, format!("app data dir: {e}"))
        })?;
        for (project_id, project_path) in indexed_project_ids {
            let data_dir = app_data_dir.clone();
            tokio::task::spawn_blocking(move || {
                let _ = build_project_index(&data_dir, &project_id, &project_path);
            });
        }
    }

    let pruned = db::delete_projects_for_location_not_in_paths(&pool, &location_id, &keep).await?;
    Ok(ScanResultDto {
        projects_discovered: discovered,
        projects_upserted: upserted,
        projects_pruned: pruned,
        dirs_skipped_errors: dirs_skipped,
        monorepos_expanded,
        workspace_warnings,
    })
}
