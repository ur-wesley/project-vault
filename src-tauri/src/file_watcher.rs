//! Watches the set of currently-open editor files and emits
//! `file:external-changed` when one of them changes on disk.
//!
//! Watches are attached to the parent directories (non-recursive) because a
//! direct file watch breaks when editors replace the file via write + rename.
//! Mtimes are de-duplicated, so an editor's write/rename pair produces a single
//! event.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::json;
use tauri::{AppHandle, Emitter, State};

fn canonical(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn mtime_ms(path: &Path) -> Option<i64> {
    std::fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
}

#[derive(Default)]
struct Inner {
    /// Canonical file path -> last mtime reported to the frontend.
    files: HashMap<PathBuf, i64>,
    /// Original macOS/Windows path per canonical file, so events carry the path
    /// the frontend actually holds.
    display: HashMap<PathBuf, PathBuf>,
    /// Directories currently being watched.
    dirs: HashSet<PathBuf>,
}

pub struct FileWatcher {
    watcher: Mutex<RecommendedWatcher>,
    inner: Arc<Mutex<Inner>>,
}

impl FileWatcher {
    pub fn new(app: AppHandle) -> Result<Self, String> {
        let inner: Arc<Mutex<Inner>> = Arc::new(Mutex::new(Inner::default()));
        let shared = inner.clone();

        let watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
            let Ok(event) = res else { return };
            if !matches!(
                event.kind,
                notify::EventKind::Modify(_) | notify::EventKind::Create(_)
            ) {
                return;
            }

            for raw in &event.paths {
                let canon = canonical(raw);
                let payload = {
                    let mut guard = shared.lock().unwrap();
                    let Some(last) = guard.files.get(&canon).copied() else {
                        continue;
                    };
                    let Some(current) = mtime_ms(&canon) else {
                        continue;
                    };
                    if current == last {
                        continue;
                    }
                    guard.files.insert(canon.clone(), current);
                    let display = guard
                        .display
                        .get(&canon)
                        .cloned()
                        .unwrap_or_else(|| canon.clone());
                    Some((display.to_string_lossy().to_string(), current))
                };
                if let Some((display, mtime)) = payload {
                    let _ = app.emit(
                        "file:external-changed",
                        json!({ "path": display, "mtimeMs": mtime }),
                    );
                }
            }
        })
        .map_err(|e| format!("failed to create file watcher: {e}"))?;

        Ok(Self {
            watcher: Mutex::new(watcher),
            inner,
        })
    }

    /// Replace the watched file set. Called whenever the open tabs change.
    pub fn set_files(&self, paths: Vec<PathBuf>) -> Result<(), String> {
        let mut guard = self.inner.lock().unwrap();

        // Recompute the desired directory set from the canonical file paths.
        let mut desired_dirs: HashSet<PathBuf> = HashSet::new();
        let mut desired_files: HashMap<PathBuf, PathBuf> = HashMap::new();
        for raw in paths {
            let canon = canonical(&raw);
            if let Some(parent) = canon.parent() {
                desired_dirs.insert(parent.to_path_buf());
            }
            desired_files.insert(canon, raw);
        }

        let mut watcher = self.watcher.lock().unwrap();

        // Drop directories that no longer host an open file.
        let stale: Vec<PathBuf> = guard
            .dirs
            .iter()
            .filter(|d| !desired_dirs.contains(*d))
            .cloned()
            .collect();
        for dir in stale {
            let _ = watcher.unwatch(&dir);
            guard.dirs.remove(&dir);
        }

        // Attach watches for new directories.
        for dir in &desired_dirs {
            if guard.dirs.contains(dir) {
                continue;
            }
            if watcher.watch(dir, RecursiveMode::NonRecursive).is_ok() {
                guard.dirs.insert(dir.clone());
            }
        }

        // Keep mtimes for files that remain open, seed the rest.
        let keep: HashSet<PathBuf> = desired_files.keys().cloned().collect();
        guard.files.retain(|p, _| keep.contains(p));
        for canon in &keep {
            if !guard.files.contains_key(canon) {
                if let Some(m) = mtime_ms(canon) {
                    guard.files.insert(canon.clone(), m);
                }
            }
        }
        guard.display = desired_files;
        Ok(())
    }
}

#[tauri::command]
pub fn watch_project_files(
    watcher: State<'_, Arc<FileWatcher>>,
    paths: Vec<String>,
) -> Result<(), String> {
    watcher.set_files(paths.into_iter().map(PathBuf::from).collect())
}
