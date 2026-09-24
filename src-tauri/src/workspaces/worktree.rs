use std::path::Path;

use serde::Serialize;

use crate::error::{codes, StableError};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: Option<String>,
    pub bare: bool,
}

fn git(repo: &Path, args: &[&str]) -> Result<std::process::Output, StableError> {
    let mut cmd = crate::process_util::hidden_command("git");
    cmd.arg("-c")
        .arg("core.quotepath=false")
        .current_dir(repo)
        .args(args);
    cmd.output()
        .map_err(|e| StableError::new(codes::SPAWN_FAILED, format!("git not runnable: {e}")))
}

fn git_ok(repo: &Path, args: &[&str], what: &str) -> Result<String, StableError> {
    let out = git(repo, args)?;
    if !out.status.success() {
        let tail = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let tail: String = tail.chars().rev().take(500).collect::<String>().chars().rev().collect();
        return Err(StableError::new(
            codes::SPAWN_FAILED,
            format!("git {what} failed: {tail}"),
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

pub fn is_git_repo(path: &Path) -> bool {
    git(path, &["rev-parse", "--git-dir"])
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn branch_exists(repo: &Path, branch: &str) -> bool {
    git(repo, &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{branch}")])
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Keep project-local worktrees out of `git status` via `.git/info/exclude`.
pub fn ensure_excluded(repo: &Path, pattern: &str) -> Result<(), StableError> {
    let exclude = repo.join(".git").join("info").join("exclude");
    let current = std::fs::read_to_string(&exclude).unwrap_or_default();
    if current.lines().any(|l| l.trim() == pattern) {
        return Ok(());
    }
    let mut next = current;
    if !next.is_empty() && !next.ends_with('\n') {
        next.push('\n');
    }
    next.push_str(pattern);
    next.push('\n');
    std::fs::write(&exclude, next)
        .map_err(|e| StableError::new(codes::MOVE_FAILED, format!("write git exclude: {e}")))?;
    Ok(())
}

/// `git worktree add --detach` is avoided: workspaces always get a branch so
/// agents can push/PR. `base` defaults to HEAD.
pub fn create_worktree(
    repo: &Path,
    worktree_path: &Path,
    branch: &str,
    base: Option<&str>,
) -> Result<(), StableError> {
    if worktree_path.exists() {
        return Err(StableError::new(
            codes::ALREADY_EXISTS,
            "worktree path already exists",
        ));
    }
    if branch_exists(repo, branch) {
        return Err(StableError::new(
            codes::ALREADY_EXISTS,
            format!("branch '{branch}' already exists"),
        ));
    }
    let base = base.unwrap_or("HEAD");
    let path = worktree_path.to_string_lossy().to_string();
    git_ok(repo, &["worktree", "add", "-b", branch, &path, base], "worktree add")?;
    Ok(())
}

/// Best-effort branch deletion (used by workspace delete with deleteBranch).
pub fn delete_branch(repo: &Path, branch: &str) -> Result<(), StableError> {
    git_ok(repo, &["branch", "-D", branch], "branch delete")?;
    Ok(())
}

/// Default PR base: `origin/HEAD` target, falling back to `main`.
pub fn default_base(repo: &Path) -> String {
    if let Ok(out) = git(repo, &["symbolic-ref", "refs/remotes/origin/HEAD"]) {
        if out.status.success() {
            let full = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if let Some(short) = full.strip_prefix("refs/remotes/origin/") {
                if !short.is_empty() {
                    return short.to_string();
                }
            }
        }
    }
    "main".to_string()
}

#[derive(Debug, Clone, Serialize)]
pub struct RepoInfo {
    pub branch: String,
    pub base: String,
    pub owner: Option<String>,
    pub repo: Option<String>,
    pub pushed: bool,
}

/// Branch/base/remote summary for the PR dialog. Never fails hard on
/// missing remotes — those fields just come back None/false.
pub fn repo_info(repo: &Path) -> RepoInfo {
    let branch = git(repo, &["branch", "--show-current"])
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "HEAD".to_string());
    let base = default_base(repo);
    let (owner, repo_name) = crate::commands::github_remote::origin_owner_repo(repo)
        .map(|(o, r)| (Some(o), Some(r)))
        .unwrap_or((None, None));
    let pushed = git(repo, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
        .map(|o| o.status.success())
        .unwrap_or(false);
    RepoInfo { branch, base, owner, repo: repo_name, pushed }
}

async fn git_async(repo: &Path, args: &[&str], timeout_secs: u64) -> Result<String, StableError> {
    use tokio::time::Duration;
    let mut cmd = crate::process_util::hidden_tokio_command("git");
    cmd.args(args).current_dir(repo);
    // Never block on credential prompts inside the app.
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    cmd.env("GIT_ASKPASS", "echo");
    let output = tokio::time::timeout(Duration::from_secs(timeout_secs), cmd.output())
        .await
        .map_err(|_| StableError::new(codes::SPAWN_FAILED, "git command timed out"))?
        .map_err(|e| StableError::new(codes::SPAWN_FAILED, format!("git not runnable: {e}")))?;
    if !output.status.success() {
        let tail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let tail: String = tail.chars().rev().take(500).collect::<String>().chars().rev().collect();
        return Err(StableError::new(codes::SPAWN_FAILED, format!("git failed: {tail}")));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// `git push -u origin <branch>` from inside the worktree. Surfaces auth
/// failures fast instead of hanging on prompts.
pub async fn push_branch(repo: &Path, branch: &str) -> Result<(), StableError> {
    git_async(repo, &["push", "-u", "origin", branch], 120).await?;
    Ok(())
}

pub fn remove_worktree(repo: &Path, worktree_path: &Path, force: bool) -> Result<(), StableError> {
    let path = worktree_path.to_string_lossy().to_string();
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(&path);
    git_ok(repo, &args, "worktree remove")?;
    // Best-effort: drop a leftover empty dir so re-create doesn't trip EXISTS.
    if worktree_path.is_dir() {
        if let Ok(mut entries) = std::fs::read_dir(worktree_path) {
            if entries.next().is_none() {
                let _ = std::fs::remove_dir(worktree_path);
            }
        }
    }
    git_ok(repo, &["worktree", "prune"], "worktree prune")?;
    Ok(())
}

/// Parse `git worktree list --porcelain` (blocks separated by blank lines).
/// Pure: unit-tested without git.
pub fn parse_worktree_porcelain(out: &str) -> Vec<WorktreeInfo> {
    let mut infos = Vec::new();
    let mut path: Option<String> = None;
    let mut branch: Option<String> = None;
    let mut bare = false;
    let mut flush = |path: &mut Option<String>, branch: &mut Option<String>, bare: &mut bool| {
        if let Some(p) = path.take() {
            infos.push(WorktreeInfo {
                path: p,
                branch: branch.take(),
                bare: *bare,
            });
            *bare = false;
        }
    };
    for line in out.lines().chain(std::iter::once("")) {
        if line.is_empty() {
            flush(&mut path, &mut branch, &mut bare);
        } else if let Some(p) = line.strip_prefix("worktree ") {
            flush(&mut path, &mut branch, &mut bare);
            path = Some(p.to_string());
        } else if let Some(b) = line.strip_prefix("branch ") {
            branch = Some(b.strip_prefix("refs/heads/").unwrap_or(b).to_string());
        } else if line == "bare" {
            bare = true;
        }
    }
    infos
}

pub fn list_worktrees(repo: &Path) -> Result<Vec<WorktreeInfo>, StableError> {
    let out = git_ok(repo, &["worktree", "list", "--porcelain"], "worktree list")?;
    Ok(parse_worktree_porcelain(&out))
}

/// NOTE: change/diff reads go through the shared implementations in
/// `crate::commands::git` (`changed_files_in` / `file_diff_in`: numstat,
/// untracked synthesis, binary guard, truncation) so workspace review shows
/// exactly what the project diff views show.

#[cfg(test)]
mod tests {
    use super::*;

    fn git_available() -> bool {
        crate::process_util::hidden_command("git")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    fn init_repo(dir: &Path) {
        let run = |args: &[&str]| {
            let o = git(dir, args).unwrap();
            assert!(o.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&o.stderr));
        };
        // init may target a dir that doesn't exist yet for worktrees; here it exists.
        run(&["init", "-b", "main"]);
        run(&["config", "user.email", "test@pv.local"]);
        run(&["config", "user.name", "pv-test"]);
        std::fs::write(dir.join("a.txt"), "hello\n").unwrap();
        run(&["add", "."]);
        run(&["commit", "-m", "init"]);
    }

    fn temp_repo() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        // `git init <path>` style: init inside via current_dir needs existing dir — it exists.
        init_repo(d.path());
        d
    }

    #[test]
    fn porcelain_parses() {
        let sample = "worktree /r\nHEAD abc\nbranch refs/heads/main\n\nworktree /r/.vault/wt\nHEAD def\nbranch refs/heads/pv/x\n\nworktree /bare\nHEAD abc\nbare\n\n";
        let infos = parse_worktree_porcelain(sample);
        assert_eq!(infos.len(), 3);
        assert_eq!(infos[0].branch.as_deref(), Some("main"));
        assert!(!infos[0].bare);
        assert_eq!(infos[1].path, "/r/.vault/wt");
        assert_eq!(infos[1].branch.as_deref(), Some("pv/x"));
        assert!(infos[2].bare);
        assert_eq!(parse_worktree_porcelain(""), Vec::new());
    }

    #[test]
    fn lifecycle_on_temp_repo() {
        if !git_available() {
            return;
        }
        let repo = temp_repo();
        assert!(is_git_repo(repo.path()));
        assert!(branch_exists(repo.path(), "main"));
        assert!(!branch_exists(repo.path(), "nope"));

        let wt = repo.path().join("wt-1");
        create_worktree(repo.path(), &wt, "pv/test-1", None).unwrap();
        assert!(wt.join("a.txt").is_file());

        // duplicate branch + existing path rejected
        assert!(create_worktree(repo.path(), &repo.path().join("wt-2"), "pv/test-1", None).is_err());

        std::fs::write(wt.join("a.txt"), "changed\n").unwrap();
        std::fs::write(wt.join("new.txt"), "new\n").unwrap();
        // Shared diff backend (numstat enrichment, untracked synthesis).
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let changes = crate::commands::git::changed_files_in(&wt).await.unwrap();
            let paths: Vec<_> = changes.iter().map(|c| c.path.as_str()).collect();
            assert!(paths.contains(&"a.txt"));
            assert!(paths.contains(&"new.txt"));
            let modified = changes.iter().find(|c| c.path == "a.txt").unwrap();
            assert!(modified.additions > 0 || modified.deletions > 0);

            let diff = crate::commands::git::file_diff_in(&wt, "a.txt").await.unwrap();
            assert!(diff.diff.contains("+changed"));
            assert!(!diff.truncated);
            // Untracked files get a synthesized new-file diff.
            let untracked = crate::commands::git::file_diff_in(&wt, "new.txt").await.unwrap();
            assert!(untracked.diff.contains("+new"));
            assert!(crate::commands::git::file_diff_in(&wt, "../evil.txt").await.is_err());
            assert!(crate::commands::git::file_diff_in(&wt, "/abs.txt").await.is_err());
        });

        let list = list_worktrees(repo.path()).unwrap();
        assert!(list.iter().any(|w| w.branch.as_deref() == Some("pv/test-1")));

        remove_worktree(repo.path(), &wt, true).unwrap();
        let list = list_worktrees(repo.path()).unwrap();
        assert!(!list.iter().any(|w| w.branch.as_deref() == Some("pv/test-1")));
    }

    #[test]
    fn base_and_info_without_remote() {
        if !git_available() {
            return;
        }
        let repo = temp_repo();
        // No origin configured: base falls back to main, no owner/repo.
        assert_eq!(default_base(repo.path()), "main");
        let info = repo_info(repo.path());
        assert_eq!(info.branch, "main");
        assert_eq!(info.base, "main");
        assert_eq!(info.owner, None);
        assert!(!info.pushed);
    }

    #[test]
    fn exclude_is_idempotent() {
        if !git_available() {
            return;
        }
        let repo = temp_repo();
        ensure_excluded(repo.path(), ".vault/worktrees/").unwrap();
        ensure_excluded(repo.path(), ".vault/worktrees/").unwrap();
        let text = std::fs::read_to_string(repo.path().join(".git/info/exclude")).unwrap();
        assert_eq!(text.lines().filter(|l| l.trim() == ".vault/worktrees/").count(), 1);
    }
}
