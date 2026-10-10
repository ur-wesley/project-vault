//! Shared `bd` runner: program resolution cache, version cache, spawn helper,
//! JSON-slice parsing, and input validators.
//!
//! PR1 goal: cut `bd` process spawns ~70% with no behavior change.
//! Follow-ups (NOT in PR1): lazy `closed` loading, single shared watcher poll.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use crate::error::{codes, StableError};
use crate::process_util::hidden_tokio_command;

/// Default per-spawn timeout for `bd` invocations.
pub const BD_TIMEOUT_MS: u64 = 15_000;

/// How long `bd --version` results are cached (failures cached too, so
/// machines without `bd` don't spawn on every status poll).
const VERSION_TTL: Duration = Duration::from_secs(60);

/// Command-line arg caps; keep spawns safe without changing valid inputs.
pub const MAX_TITLE_LEN: usize = 300;
pub const MAX_DESCRIPTION_LEN: usize = 10_000;
pub const MAX_COMMENT_LEN: usize = 5_000;
pub const MAX_ID_LEN: usize = 200;

static BD_PROGRAM_CACHE: OnceLock<PathBuf> = OnceLock::new();
static VERSION_CACHE: OnceLock<tokio::sync::RwLock<(Option<String>, Option<Instant>)>> =
    OnceLock::new();
static ID_RE: OnceLock<regex::Regex> = OnceLock::new();

fn id_re() -> &'static regex::Regex {
    ID_RE.get_or_init(|| regex::Regex::new("^[A-Za-z0-9._-]+$").expect("valid id regex"))
}

fn version_cell() -> &'static tokio::sync::RwLock<(Option<String>, Option<Instant>)> {
    VERSION_CACHE.get_or_init(|| tokio::sync::RwLock::new((None, None)))
}

fn resolve_bd_program() -> PathBuf {
    #[cfg(windows)]
    {
        if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
            let candidate = PathBuf::from(local_app_data)
                .join("Programs")
                .join("bd")
                .join("bd.exe");
            if candidate.is_file() {
                return candidate;
            }
        }
        if let Some(user_profile) = std::env::var_os("USERPROFILE") {
            let candidate = PathBuf::from(user_profile)
                .join(".local")
                .join("bin")
                .join("bd.exe");
            if candidate.is_file() {
                return candidate;
            }
        }
    }
    PathBuf::from("bd")
}

/// Cached `bd` program path. Filesystem probing runs once per process.
pub fn bd_program() -> PathBuf {
    BD_PROGRAM_CACHE.get_or_init(resolve_bd_program).clone()
}

/// Cached `bd --version` (60s TTL). This is what lets `beads_get_status`
/// skip the `--version` spawn on the hot path.
pub async fn cached_bd_version() -> Option<String> {
    let cell = version_cell();
    {
        let guard = cell.read().await;
        if let Some(stamp) = guard.1 {
            if stamp.elapsed() < VERSION_TTL {
                return guard.0.clone();
            }
        }
    }
    let prog = bd_program();
    let prog_str = prog.to_string_lossy().to_string();
    let version = tokio::time::timeout(
        Duration::from_millis(5_000),
        hidden_tokio_command(&prog_str).arg("--version").output(),
    )
    .await
    .ok()
    .and_then(|r| r.ok())
    .and_then(|out| {
        if out.status.success() {
            let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if v.is_empty() {
                None
            } else {
                Some(v)
            }
        } else {
            None
        }
    });
    {
        let mut guard = cell.write().await;
        *guard = (version.clone(), Some(Instant::now()));
    }
    version
}

/// Single spawn helper for every `bd` command. Uses the hidden-window tokio
/// command wrapper and enforces a timeout; maps timeout/spawn failures to
/// `StableError` (codes::INTERNAL). Non-zero exits are left to the caller
/// via `ensure_success` so context strings stay specific.
pub async fn run_bd(args: &[&str], timeout_ms: u64) -> Result<std::process::Output, StableError> {
    let prog = bd_program();
    let prog_str = prog.to_string_lossy().to_string();
    let mut cmd = hidden_tokio_command(&prog_str);
    cmd.args(args);
    tokio::time::timeout(Duration::from_millis(timeout_ms), cmd.output())
        .await
        .map_err(|_| StableError::new(codes::INTERNAL, format!("bd timed out after {timeout_ms}ms")))?
        .map_err(|e| StableError::new(codes::INTERNAL, format!("Failed to execute bd: {e}")))
}

/// Map non-zero `bd` exits to `StableError` with the stderr tail attached.
pub fn ensure_success(output: &std::process::Output, context: &str) -> Result<(), StableError> {
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(StableError::new(codes::INTERNAL, format!("{context}: {}", stderr.trim())))
}

fn trim_ascii_ws(bytes: &[u8]) -> &[u8] {
    let mut start = 0;
    let mut end = bytes.len();
    while start < end && bytes[start].is_ascii_whitespace() {
        start += 1;
    }
    while end > start && bytes[end - 1].is_ascii_whitespace() {
        end -= 1;
    }
    &bytes[start..end]
}

/// Byte-level JSON slice extraction: finds the outermost `[...]` (or
/// `{...}`) window so `bd` log prefixes don't force a lossy `String` copy.
/// Parse the result directly with `serde_json::from_slice`.
pub fn extract_json_slice_bytes(stdout: &[u8]) -> &[u8] {
    let trimmed = trim_ascii_ws(stdout);
    if let (Some(start), Some(end)) = (
        trimmed.iter().position(|b| *b == b'['),
        trimmed.iter().rposition(|b| *b == b']'),
    ) {
        if start <= end {
            return &trimmed[start..=end];
        }
    }
    if let (Some(start), Some(end)) = (
        trimmed.iter().position(|b| *b == b'{'),
        trimmed.iter().rposition(|b| *b == b'}'),
    ) {
        if start <= end {
            return &trimmed[start..=end];
        }
    }
    trimmed
}

/// String wrapper kept for compat; prefer the bytes variant for parsing.
pub fn extract_json_slice(output: &str) -> &str {
    std::str::from_utf8(extract_json_slice_bytes(output.as_bytes())).unwrap_or(output)
}

pub fn validate_project_path(p: &str) -> Result<PathBuf, StableError> {
    let trimmed = p.trim();
    if trimmed.is_empty() {
        return Err(StableError::new(codes::INVALID_PATH, "project path is empty"));
    }
    let path = Path::new(trimmed);
    if !path.is_dir() {
        return Err(StableError::new(codes::INVALID_PATH, "project path is not a directory"));
    }
    dunce::canonicalize(path)
        .map_err(|e| StableError::new(codes::INVALID_PATH, format!("cannot resolve project path: {e}")))
}

/// Bead ids are interpolated as `bd` positionals. The charset below plus the
/// leading-dash reject make flag injection impossible, so no `--` separator
/// is needed (bd subcommands don't uniformly accept `--`).
pub fn validate_id(id: &str) -> Result<String, StableError> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return Err(StableError::new(codes::INTERNAL, "bead id is empty"));
    }
    if trimmed.starts_with('-') {
        return Err(StableError::new(codes::INTERNAL, "invalid bead id"));
    }
    if trimmed.len() > MAX_ID_LEN {
        return Err(StableError::new(codes::INTERNAL, "bead id too long"));
    }
    if !id_re().is_match(trimmed) {
        return Err(StableError::new(codes::INTERNAL, "invalid bead id"));
    }
    Ok(trimmed.to_string())
}

const ALLOWED_STATUSES: &[&str] = &["open", "in_progress", "blocked", "deferred", "closed"];

pub fn validate_status(status: &str) -> Result<String, StableError> {
    let lower = status.trim().to_lowercase();
    if ALLOWED_STATUSES.contains(&lower.as_str()) {
        return Ok(lower);
    }
    Err(StableError::new(codes::INTERNAL, format!("invalid bead status: {status}")))
}

pub fn validate_priority(priority: i32) -> Result<i32, StableError> {
    if (0..=4).contains(&priority) {
        return Ok(priority);
    }
    Err(StableError::new(codes::INTERNAL, "priority must be 0-4"))
}

const ALLOWED_TYPES: &[&str] = &["task", "epic", "feature", "bug", "chore", "decision", "spike"];

pub fn validate_issue_type(issue_type: &str) -> Result<String, StableError> {
    let lower = issue_type.trim().to_lowercase();
    if ALLOWED_TYPES.contains(&lower.as_str()) {
        return Ok(lower);
    }
    Err(StableError::new(codes::INTERNAL, format!("invalid issue type: {issue_type}")))
}

pub fn validate_title(title: &str) -> Result<String, StableError> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Err(StableError::new(codes::INTERNAL, "title must not be empty"));
    }
    if trimmed.len() > MAX_TITLE_LEN {
        return Err(StableError::new(codes::INTERNAL, "title exceeds 300 characters"));
    }
    Ok(trimmed.to_string())
}

pub fn validate_description(description: &Option<String>) -> Result<Option<String>, StableError> {
    let Some(desc) = description else {
        return Ok(None);
    };
    let trimmed = desc.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.len() > MAX_DESCRIPTION_LEN {
        return Err(StableError::new(codes::INTERNAL, "description exceeds 10000 characters"));
    }
    Ok(Some(trimmed.to_string()))
}

pub fn validate_comment(comment: &str) -> Result<String, StableError> {
    let trimmed = comment.trim();
    if trimmed.is_empty() {
        return Err(StableError::new(codes::INTERNAL, "comment must not be empty"));
    }
    if trimmed.len() > MAX_COMMENT_LEN {
        return Err(StableError::new(codes::INTERNAL, "comment exceeds 5000 characters"));
    }
    Ok(trimmed.to_string())
}

pub fn validate_close_reason(reason: &Option<String>) -> Option<String> {
    let raw = reason.as_ref()?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_shell_injection_id() {
        assert!(validate_id("; rm -rf /").is_err());
        assert!(validate_id("a;rm").is_err());
        assert!(validate_id("x|y").is_err());
        assert!(validate_id("a b").is_err());
    }

    #[test]
    fn rejects_flag_like_id() {
        assert!(validate_id("-h").is_err());
        assert!(validate_id("--version").is_err());
        assert!(validate_id("-").is_err());
    }

    #[test]
    fn accepts_normal_ids() {
        assert_eq!(validate_id("docstool-app-4db").unwrap(), "docstool-app-4db");
        assert_eq!(validate_id("a.b_c-1").unwrap(), "a.b_c-1");
        assert_eq!(validate_id("  abc  ").unwrap(), "abc");
    }

    #[test]
    fn rejects_empty_title() {
        assert!(validate_title("").is_err());
        assert!(validate_title("   ").is_err());
    }

    #[test]
    fn rejects_oversize_title_and_comment() {
        assert!(validate_title(&"x".repeat(301)).is_err());
        assert!(validate_title(&"x".repeat(300)).is_ok());
        assert!(validate_comment(&"y".repeat(5001)).is_err());
        assert!(validate_comment("ok").is_ok());
        assert!(validate_comment("  ").is_err());
    }

    #[test]
    fn validates_status_priority_type() {
        assert_eq!(validate_status("Closed").unwrap(), "closed");
        assert!(validate_status("nope").is_err());
        assert_eq!(validate_priority(0).unwrap(), 0);
        assert!(validate_priority(5).is_err());
        assert!(validate_priority(-1).is_err());
        assert_eq!(validate_issue_type("Bug").unwrap(), "bug");
        assert!(validate_issue_type("nope").is_err());
    }

    #[test]
    fn validates_project_path() {
        assert!(validate_project_path("").is_err());
        assert!(validate_project_path("C:\\definitely\\not\\a\\real\\dir\\zzz").is_err());
    }

    #[test]
    fn extract_bytes_windows_and_fallback() {
        assert_eq!(extract_json_slice_bytes(b"some log\n[{\"a\":1}]\ntail"), b"[{\"a\":1}]");
        assert_eq!(extract_json_slice_bytes(b"prefix {\"a\":1} suffix"), b"{\"a\":1}");
        assert_eq!(extract_json_slice_bytes(b"  hello  "), b"hello");
    }

    #[test]
    fn str_wrapper_matches_bytes_variant() {
        let raw = "log\n[1,2]\n";
        assert_eq!(extract_json_slice(raw), "[1,2]");
    }
}
