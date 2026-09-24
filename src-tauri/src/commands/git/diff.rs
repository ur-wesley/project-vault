use std::collections::HashMap;
use std::path::{Component, Path};

use serde::Serialize;
use tauri::State;
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::error::{codes, StableError};

use super::utils::{is_git_repo, run_git_async};

/// Cap on files returned by `git_changed_files` so huge worktrees can't
/// blow up the IPC payload. The porcelain output is simply truncated.
pub const MAX_CHANGED_FILES: usize = 200;
/// Cap on diff bytes returned by `git_file_diff`. Output is truncated on a
/// char boundary and flagged via `truncated`.
pub const MAX_DIFF_BYTES: usize = 100 * 1024;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitChangedFile {
    pub path: String,
    /// Single-letter porcelain status: M, A, D, R, U or ? (untracked).
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitFileDiff {
    pub path: String,
    pub diff: String,
    pub truncated: bool,
}

/// Parse one `git status --porcelain=v1` line into (path, status letter).
/// Returns None for blank/malformed lines.
fn parse_porcelain_line(line: &str) -> Option<(String, String)> {
    let bytes = line.as_bytes();
    if bytes.len() < 4 {
        return None;
    }
    let x = bytes[0] as char;
    let y = bytes[1] as char;
    // Format is `XY <path>`; anything else is malformed.
    if bytes[2] != b' ' {
        return None;
    }
    let mut raw = line[3..].trim();
    if raw.is_empty() {
        return None;
    }
    // Renames/copies look like `old -> new`; the new path is what matters.
    if x == 'R' || x == 'C' {
        if let Some((_, new)) = raw.split_once(" -> ") {
            raw = new.trim();
        }
    }
    // Strip surrounding quotes git adds for paths with special chars.
    let path = raw.trim_matches('"').to_string();
    if path.is_empty() {
        return None;
    }
    let status = if x == '?' || y == '?' {
        "?".to_string()
    } else if x == 'U' || y == 'U' || (x == 'A' && y == 'A') || (x == 'D' && y == 'D') {
        "U".to_string()
    } else if y != ' ' {
        // Worktree status wins: it reflects what's actually on disk.
        y.to_string()
    } else {
        x.to_string()
    };
    Some((path, status))
}

/// Parse `git diff --numstat` output into path -> (additions, deletions).
/// Binary files report `-\t-\t<path>` and map to (0, 0). Rename entries
/// (`{old => new}` / `old => new`) resolve to the post-image path.
fn parse_numstat(output: &str) -> HashMap<String, (u32, u32)> {
    let mut map = HashMap::new();
    for line in output.lines() {
        let mut parts = line.split('\t');
        let (Some(add), Some(del), Some(raw_path)) = (parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        let additions = add.parse().unwrap_or(0);
        let deletions = del.parse().unwrap_or(0);
        let path = if let Some((_, new)) = raw_path.split_once(" => ") {
            // `{a => b}c` brace form or plain `old => new` form.
            let new = new.trim().trim_end_matches('}');
            // Brace form keeps a shared prefix: `{src/a => src/b}.ts`.
            if let Some((prefix, _)) = raw_path.split_once("{") {
                format!("{prefix}{new}")
            } else {
                new.to_string()
            }
        } else {
            raw_path.trim_matches('"').to_string()
        };
        if !path.is_empty() {
            map.insert(path, (additions, deletions));
        }
    }
    map
}

/// Reject absolute paths and anything escaping the repo root.
fn validate_relative_path(path: &str) -> Result<(), StableError> {
    let p = Path::new(path);
    if p.is_absolute() {
        return Err(StableError::new(
            codes::INVALID_PATH,
            "absolute paths are not allowed",
        ));
    }
    if path.is_empty()
        || p.components()
            .any(|c| matches!(c, Component::ParentDir | Component::Prefix(_)))
    {
        return Err(StableError::new(codes::INVALID_PATH, "invalid file path"));
    }
    Ok(())
}

fn truncate_on_char_boundary(s: &str, max_bytes: usize) -> (&str, bool) {
    if s.len() <= max_bytes {
        return (s, false);
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    (&s[..end], true)
}

/// Path-based core behind `git_changed_files` so workspace worktrees reuse
/// the same parsing, caps, and numstat enrichment.
pub async fn changed_files_in(cwd: &Path) -> Result<Vec<GitChangedFile>, StableError> {
    if !is_git_repo(cwd) {
        return Err(StableError::new(codes::INTERNAL, "not a git repository"));
    }

    let porcelain = run_git_async(cwd, &["status", "--porcelain=v1"]).await?;
    // Against HEAD so staged changes are included, not just the worktree.
    let numstat_out = run_git_async(cwd, &["diff", "HEAD", "--numstat"])
        .await
        .unwrap_or_default();
    let numstat = parse_numstat(&numstat_out);

    let mut files = Vec::new();
    for line in porcelain.lines() {
        if files.len() >= MAX_CHANGED_FILES {
            break;
        }
        let Some((path, status)) = parse_porcelain_line(line) else {
            continue;
        };
        let (additions, deletions) = numstat.get(&path).copied().unwrap_or((0, 0));
        files.push(GitChangedFile {
            path,
            status,
            additions,
            deletions,
        });
    }
    Ok(files)
}

#[tauri::command]
pub async fn git_changed_files(
    db: State<'_, DbInstances>,
    project_id: String,
) -> Result<Vec<GitChangedFile>, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &project_id).await?;
    changed_files_in(Path::new(&project.path)).await
}

/// Path-based core behind `git_file_diff` (tracked vs HEAD, untracked
/// synthesized, binary guarded, truncated on a char boundary).
pub async fn file_diff_in(cwd: &Path, path: &str) -> Result<GitFileDiff, StableError> {
    validate_relative_path(path)?;

    if !is_git_repo(cwd) {
        return Err(StableError::new(codes::INTERNAL, "not a git repository"));
    }

    // Tracked files: diff against HEAD covers staged + unstaged changes.
    let tracked = run_git_async(cwd, &["ls-files", "--error-unmatch", "--", path])
        .await
        .is_ok();

    let raw = if tracked {
        run_git_async(
            cwd,
            &["diff", "--no-color", "--no-ext-diff", "HEAD", "--", path],
        )
        .await?
    } else {
        // Untracked: synthesize a new-file diff so the node can show content
        // without depending on `--no-index /dev/null` platform behavior.
        let full = cwd.join(path);
        let bytes = std::fs::read(&full)
            .map_err(|e| StableError::new(codes::INTERNAL, format!("failed to read file: {e}")))?;
        if bytes.contains(&0) {
            return Ok(GitFileDiff {
                path: path.to_string(),
                diff: "Binary file not shown.".to_string(),
                truncated: false,
            });
        }
        let text = String::from_utf8_lossy(&bytes);
        let mut out = format!("--- /dev/null\n+++ b/{path}\n");
        for line in text.lines() {
            out.push('+');
            out.push_str(line);
            out.push('\n');
        }
        out
    };

    if raw.as_bytes().contains(&0) {
        return Ok(GitFileDiff {
            path: path.to_string(),
            diff: "Binary file not shown.".to_string(),
            truncated: false,
        });
    }

    let (diff, truncated) = truncate_on_char_boundary(&raw, MAX_DIFF_BYTES);
    Ok(GitFileDiff {
        path: path.to_string(),
        diff: diff.to_string(),
        truncated,
    })
}

#[tauri::command]
pub async fn git_file_diff(
    db: State<'_, DbInstances>,
    project_id: String,
    path: String,
) -> Result<GitFileDiff, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &project_id).await?;
    file_diff_in(Path::new(&project.path), &path).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_standard_porcelain_statuses() {
        assert_eq!(
            parse_porcelain_line(" M src/app.ts"),
            Some(("src/app.ts".to_string(), "M".to_string()))
        );
        assert_eq!(
            parse_porcelain_line("M  src/app.ts"),
            Some(("src/app.ts".to_string(), "M".to_string()))
        );
        assert_eq!(
            parse_porcelain_line("A  new.ts"),
            Some(("new.ts".to_string(), "A".to_string()))
        );
        assert_eq!(
            parse_porcelain_line(" D gone.ts"),
            Some(("gone.ts".to_string(), "D".to_string()))
        );
        assert_eq!(
            parse_porcelain_line("?? untracked.ts"),
            Some(("untracked.ts".to_string(), "?".to_string()))
        );
    }

    #[test]
    fn worktree_status_wins_and_conflicts_map_to_u() {
        // Staged add + worktree modification -> worktree M.
        assert_eq!(
            parse_porcelain_line("AM both.ts"),
            Some(("both.ts".to_string(), "M".to_string()))
        );
        assert_eq!(
            parse_porcelain_line("UU conflict.ts"),
            Some(("conflict.ts".to_string(), "U".to_string()))
        );
        assert_eq!(
            parse_porcelain_line("R  old.ts -> new.ts"),
            Some(("new.ts".to_string(), "R".to_string()))
        );
    }

    #[test]
    fn leading_space_status_lines_survive() {
        // run_git_async must only trim_end: the leading XY space is
        // significant (` M` = unstaged modification). Full trim() silently
        // dropped these lines (unstaged edits invisible in review).
        let raw = " M src/app.ts\n D gone.ts\n?? new.ts\n";
        let parsed: Vec<_> = raw.trim_end().lines().filter_map(parse_porcelain_line).collect();
        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[0].1, "M");
        assert_eq!(parsed[1].1, "D");
    }

    #[test]
    fn rejects_malformed_porcelain_lines() {
        assert_eq!(parse_porcelain_line(""), None);
        assert_eq!(parse_porcelain_line("M"), None);
        assert_eq!(parse_porcelain_line("Mnospace"), None);
        assert_eq!(parse_porcelain_line("M  "), None);
    }

    #[test]
    fn parses_numstat_with_binary_and_rename() {
        let out = "10\t2\tsrc/app.ts\n-\t-\tassets/logo.png\n1\t1\tsrc/{old.ts => new.ts}\n";
        let map = parse_numstat(out);
        assert_eq!(map.get("src/app.ts"), Some(&(10, 2)));
        assert_eq!(map.get("assets/logo.png"), Some(&(0, 0)));
        assert_eq!(map.get("src/new.ts"), Some(&(1, 1)));
    }

    #[test]
    fn rejects_escaping_paths() {
        assert!(validate_relative_path("src/app.ts").is_ok());
        assert!(validate_relative_path("../outside.ts").is_err());
        assert!(validate_relative_path("").is_err());
        #[cfg(unix)]
        assert!(validate_relative_path("/etc/passwd").is_err());
    }

    #[test]
    fn truncates_on_char_boundary() {
        let (s, truncated) = truncate_on_char_boundary("abcdef", 10);
        assert_eq!((s, truncated), ("abcdef", false));
        // "é" is 2 bytes; max 2 bytes of "aé" must not split the char.
        let (s, truncated) = truncate_on_char_boundary("aé", 2);
        assert_eq!((s, truncated), ("a", true));
    }
}
