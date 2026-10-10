use std::path::Path;
use tauri::State;

use super::dto::{
    AddBeadCommentInput, BeadCommentDto, BeadIssueDto, BeadsStatusDto, CreateBeadInput,
    UpdateBeadStatusInput,
};
use super::runner::{
    BD_TIMEOUT_MS, cached_bd_version, ensure_success, extract_json_slice_bytes, run_bd,
    validate_close_reason, validate_comment, validate_description, validate_id,
    validate_issue_type, validate_priority, validate_project_path, validate_status,
    validate_title,
};
use super::watcher::BeadsWatcher;
use crate::error::StableError;

#[tauri::command]
pub async fn beads_get_status(project_path: String) -> BeadsStatusDto {
    // Filesystem check only; `bd --version` comes from the 60s cache so the
    // hot path spawns zero processes.
    let initialized = Path::new(&project_path).join(".beads").is_dir();

    let version = cached_bd_version().await;
    let installed = version.is_some();

    BeadsStatusDto {
        installed,
        initialized,
        version,
        // Deprecated best-effort: kept for compat but never spawn for it.
        // UI falls back to `issuesQ.data.length` when available.
        issue_count: 0,
    }
}

#[tauri::command]
pub async fn beads_list_issues(project_path: String) -> Result<Vec<BeadIssueDto>, StableError> {
    let path = validate_project_path(&project_path)?;
    let path_str = path.to_string_lossy().to_string();
    // NOTE: all statuses (incl. closed) load eagerly for now; lazy-closed is
    // an explicit follow-up, not PR1, to avoid behavior change.
    let output = run_bd(
        &[
            "-C",
            &path_str,
            "list",
            "--status",
            "open,in_progress,blocked,deferred,closed",
            "--json",
        ],
        BD_TIMEOUT_MS,
    )
    .await?;
    ensure_success(&output, "bd list error")?;

    let slice = extract_json_slice_bytes(&output.stdout);
    serde_json::from_slice::<Vec<BeadIssueDto>>(slice).map_err(|e| {
        StableError::new(
            crate::error::codes::INTERNAL,
            format!("Failed to parse beads json: {e}"),
        )
    })
}

#[tauri::command]
pub async fn beads_create_issue(input: CreateBeadInput) -> Result<BeadIssueDto, StableError> {
    let path = validate_project_path(&input.project_path)?;
    let title = validate_title(&input.title)?;
    let issue_type = validate_issue_type(&input.issue_type)?;
    let priority = validate_priority(input.priority)?;
    let description = validate_description(&input.description)?;

    let path_str = path.to_string_lossy().to_string();
    let priority_str = priority.to_string();
    let mut owned: Vec<String> = vec![
        "-C".to_string(),
        path_str,
        "create".to_string(),
        "--title".to_string(),
        title,
        "--type".to_string(),
        issue_type,
        "--priority".to_string(),
        priority_str,
    ];
    if let Some(desc) = description {
        owned.push("--description".to_string());
        owned.push(desc);
    }
    owned.push("--json".to_string());
    let refs: Vec<&str> = owned.iter().map(|s| s.as_str()).collect();
    let output = run_bd(&refs, BD_TIMEOUT_MS).await?;
    ensure_success(&output, "bd create failed")?;

    let slice = extract_json_slice_bytes(&output.stdout);
    serde_json::from_slice::<BeadIssueDto>(slice).or_else(|_| {
        // Some bd versions return an array with 1 item
        serde_json::from_slice::<Vec<BeadIssueDto>>(slice)
            .map_err(|e| {
                StableError::new(
                    crate::error::codes::INTERNAL,
                    format!("Failed to parse created bead: {e}"),
                )
            })
            .and_then(|items| {
                items.into_iter().next().ok_or_else(|| {
                    StableError::new(
                        crate::error::codes::INTERNAL,
                        "No bead returned from create",
                    )
                })
            })
    })
}

#[tauri::command]
pub async fn beads_update_issue_status(input: UpdateBeadStatusInput) -> Result<(), StableError> {
    let path = validate_project_path(&input.project_path)?;
    let id = validate_id(&input.id)?;
    let status = validate_status(&input.status)?;
    let close_reason = validate_close_reason(&input.close_reason);

    let path_str = path.to_string_lossy().to_string();
    // NOTE: `close`/`reopen`/`update` branch (same mapping as before PR1).
    // Ids are pre-validated (no leading `-`), so no `--` separator is needed.
    let owned: Vec<String> = if status == "closed" {
        let mut v = vec!["-C".to_string(), path_str, "close".to_string(), id];
        if let Some(reason) = close_reason {
            v.push("--reason".to_string());
            v.push(reason);
        }
        v
    } else if status == "open" {
        vec!["-C".to_string(), path_str, "reopen".to_string(), id]
    } else {
        vec![
            "-C".to_string(),
            path_str,
            "update".to_string(),
            id,
            "--status".to_string(),
            status,
        ]
    };
    let refs: Vec<&str> = owned.iter().map(|s| s.as_str()).collect();
    let output = run_bd(&refs, BD_TIMEOUT_MS).await?;
    ensure_success(&output, "bd status update failed")?;

    Ok(())
}

#[tauri::command]
pub async fn beads_init(project_path: String) -> Result<(), StableError> {
    let path = validate_project_path(&project_path)?;
    let path_str = path.to_string_lossy().to_string();
    let output = run_bd(&["-C", &path_str, "init"], BD_TIMEOUT_MS).await?;
    ensure_success(&output, "bd init failed")?;

    Ok(())
}

#[tauri::command]
pub async fn beads_get_comments(
    project_path: String,
    id: String,
) -> Result<Vec<BeadCommentDto>, StableError> {
    let path = validate_project_path(&project_path)?;
    let id = validate_id(&id)?;
    let path_str = path.to_string_lossy().to_string();
    let output = run_bd(
        &["-C", &path_str, "comments", &id, "--json"],
        BD_TIMEOUT_MS,
    )
    .await?;
    ensure_success(&output, "bd comments failed")?;

    let slice = extract_json_slice_bytes(&output.stdout);
    serde_json::from_slice::<Vec<BeadCommentDto>>(slice).map_err(|e| {
        StableError::new(
            crate::error::codes::INTERNAL,
            format!("Failed to parse bead comments: {e}"),
        )
    })
}

#[tauri::command]
pub async fn beads_add_comment(input: AddBeadCommentInput) -> Result<(), StableError> {
    let path = validate_project_path(&input.project_path)?;
    let id = validate_id(&input.id)?;
    let comment = validate_comment(&input.comment)?;
    let path_str = path.to_string_lossy().to_string();
    let output = run_bd(
        &["-C", &path_str, "comments", "add", &id, &comment],
        BD_TIMEOUT_MS,
    )
    .await?;
    ensure_success(&output, "bd comments add failed")?;

    Ok(())
}

#[tauri::command]
pub async fn start_beads_watcher(
    beads_watcher: State<'_, BeadsWatcher>,
    project_id: String,
    project_path: String,
) -> Result<(), StableError> {
    beads_watcher
        .start(&project_id, &project_path)
        .await
        .map_err(|e| StableError::new(crate::error::codes::INTERNAL, e))
}

#[tauri::command]
pub async fn stop_beads_watcher(
    beads_watcher: State<'_, BeadsWatcher>,
    project_id: String,
) -> Result<(), StableError> {
    beads_watcher.stop(&project_id).await;
    Ok(())
}
