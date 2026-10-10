use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

struct ProjectWatchEntry {
    alive: Arc<AtomicBool>,
    trigger_tx: mpsc::Sender<()>,
    watched_paths: Vec<PathBuf>,
}

#[derive(Clone)]
pub struct BeadsWatcher {
    app: AppHandle,
    entries: Arc<tokio::sync::Mutex<HashMap<String, ProjectWatchEntry>>>,
    watcher: Arc<Mutex<Option<RecommendedWatcher>>>,
}

impl BeadsWatcher {
    pub fn new(app: AppHandle) -> Self {
        let entries = Arc::new(tokio::sync::Mutex::new(HashMap::<String, ProjectWatchEntry>::new()));
        let watcher: Arc<Mutex<Option<RecommendedWatcher>>> = Arc::new(Mutex::new(None));

        let watcher_entries = entries.clone();

        // Create recommended watcher
        let rec_watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
            let Ok(event) = res else { return };
            if !matches!(
                event.kind,
                notify::EventKind::Modify(_)
                    | notify::EventKind::Create(_)
                    | notify::EventKind::Remove(_)
            ) {
                return;
            }

            // Lock synchronously to notify debouncers
            let rt = tokio::runtime::Handle::try_current();
            let entries_clone = watcher_entries.clone();
            let paths = event.paths.clone();

            let notify_work = async move {
                let guard = entries_clone.lock().await;
                for entry in guard.values() {
                    let matches_project = paths.iter().any(|p| {
                        entry.watched_paths.iter().any(|watched| p.starts_with(watched))
                    });
                    if matches_project {
                        let _ = entry.trigger_tx.send(()).await;
                    }
                }
            };

            if let Ok(handle) = rt {
                handle.spawn(notify_work);
            } else {
                tauri::async_runtime::spawn(notify_work);
            }
        });

        match rec_watcher {
            Ok(w) => {
                *watcher.lock().unwrap() = Some(w);
            }
            Err(e) => {
                eprintln!("[beads_watcher] failed to initialize notify: {e}");
            }
        }

        Self {
            app,
            entries,
            watcher,
        }
    }

    pub async fn start(&self, project_id: &str, project_path: &str) -> Result<(), String> {
        let root = Path::new(project_path);
        let beads_dir = root.join(".beads");

        // PR1: watch ONLY `.beads` (recursive). The old root non-recursive
        // watch fired on every project file change; removals halve wakeups.
        // When `.beads` doesn't exist yet, nothing is watched and the 10s
        // mtime poll below still detects `bd init`.
        let mut paths_to_watch = Vec::new();
        if beads_dir.is_dir() {
            paths_to_watch.push(dunce::canonicalize(&beads_dir).unwrap_or(beads_dir.clone()));
        }

        // Skip re-watch when the entry already tracks the same canonical
        // paths (saves re-subscribe churn on every tab refocus).
        {
            let entries = self.entries.lock().await;
            if let Some(existing) = entries.get(project_id) {
                if existing.watched_paths == paths_to_watch {
                    return Ok(());
                }
            }
        }
        self.stop(project_id).await;

        // Attach watches (recursive; `.beads` only)
        {
            let mut guard = self.watcher.lock().unwrap();
            if let Some(w) = guard.as_mut() {
                for p in &paths_to_watch {
                    let _ = w.watch(p, RecursiveMode::Recursive);
                }
            }
        }

        let alive = Arc::new(AtomicBool::new(true));
        let alive_clone = alive.clone();
        let (tx, mut rx) = mpsc::channel::<()>(32);

        let app = self.app.clone();
        let pid = project_id.to_string();
        let target_beads_dir = beads_dir.clone();

        // Spawn debouncing and polling loop
        tauri::async_runtime::spawn(async move {
            let mut last_mtime = get_last_touched_mtime(&target_beads_dir).await;

            while alive_clone.load(Ordering::Relaxed) {
                tokio::select! {
                    Some(_) = rx.recv() => {
                        // Drain any rapid-fire events for 300ms
                        tokio::time::sleep(Duration::from_millis(300)).await;
                        while rx.try_recv().is_ok() {}

                        if alive_clone.load(Ordering::Relaxed) {
                            last_mtime = get_last_touched_mtime(&target_beads_dir).await;
                            let _ = app.emit("beads:changed", json!({ "projectId": pid }));
                        }
                    }
                    _ = tokio::time::sleep(Duration::from_millis(10_000)) => {
                        // 10s mtime fallback poll (was 2.5s; halves wakeups).
                        // FOLLOW-UP: replace these per-project poll loops with
                        // a single shared poll task.
                        if !alive_clone.load(Ordering::Relaxed) {
                            break;
                        }
                        let current_mtime = get_last_touched_mtime(&target_beads_dir).await;
                        if current_mtime != last_mtime {
                            last_mtime = current_mtime;
                            let _ = app.emit("beads:changed", json!({ "projectId": pid }));
                        }
                    }
                }
            }
        });

        let mut entries = self.entries.lock().await;
        entries.insert(
            project_id.to_string(),
            ProjectWatchEntry {
                alive,
                trigger_tx: tx,
                watched_paths: paths_to_watch,
            },
        );

        Ok(())
    }

    pub async fn stop(&self, project_id: &str) {
        let mut entries = self.entries.lock().await;
        if let Some(entry) = entries.remove(project_id) {
            entry.alive.store(false, Ordering::Relaxed);
            let mut guard = self.watcher.lock().unwrap();
            if let Some(w) = guard.as_mut() {
                for p in &entry.watched_paths {
                    let _ = w.unwatch(p);
                }
            }
        }
    }
}

async fn get_last_touched_mtime(beads_dir: &Path) -> Option<std::time::SystemTime> {
    let last_touched = beads_dir.join("last-touched");
    if let Ok(meta) = tokio::fs::metadata(&last_touched).await {
        return meta.modified().ok();
    }
    if let Ok(meta) = tokio::fs::metadata(beads_dir).await {
        return meta.modified().ok();
    }
    None
}
