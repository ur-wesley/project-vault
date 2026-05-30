use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

struct WatcherEntry {
    _watcher: RecommendedWatcher,
    alive: Arc<AtomicBool>,
}

pub struct GitWatcher {
    app: AppHandle,
    watchers: Arc<Mutex<HashMap<String, Arc<WatcherEntry>>>>,
}

impl GitWatcher {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            watchers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn start(&self, project_id: &str, project_path: &str) -> Result<(), String> {
        self.stop(project_id).await;

        let git_dir = Path::new(project_path).join(".git");
        if !git_dir.exists() {
            return Err(format!("no .git directory at {project_path}"));
        }

        let pid = project_id.to_string();
        let debounce_dir = git_dir.clone();
        let alive = Arc::new(AtomicBool::new(true));
        let alive_clone = alive.clone();

        let mut watcher = notify::recommended_watcher({
            let app = self.app.clone();
            let pid = pid.clone();
            let alive = alive_clone.clone();
            let mut last_event = Instant::now();

            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    match event.kind {
                        EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_) => {}
                        _ => return,
                    }

                    let dominated = event
                        .paths
                        .iter()
                        .any(|p| is_git_meta_path(p, &debounce_dir));
                    if !dominated {
                        return;
                    }

                    let now = Instant::now();
                    if now.duration_since(last_event) < Duration::from_millis(500) {
                        return;
                    }
                    last_event = now;

                    if !alive.load(Ordering::Relaxed) {
                        return;
                    }

                    let app = app.clone();
                    let pid = pid.clone();
                    let alive = alive.clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(Duration::from_millis(500)).await;
                        if alive.load(Ordering::Relaxed) {
                            let _ = app.emit("git:changed", json!({ "projectId": pid }));
                        }
                    });
                }
            }
        })
        .map_err(|e| format!("failed to create git watcher: {e}"))?;

        let watch_path = if git_dir.is_dir() { &git_dir } else { Path::new(project_path) };
        watcher
            .watch(watch_path, RecursiveMode::Recursive)
            .map_err(|e| format!("failed to watch git dir: {e}"))?;

        let entry = Arc::new(WatcherEntry {
            _watcher: watcher,
            alive,
        });

        let mut map = self.watchers.lock().await;
        map.insert(pid, entry);

        Ok(())
    }

    pub async fn stop(&self, project_id: &str) {
        let mut map = self.watchers.lock().await;
        if let Some(entry) = map.remove(project_id) {
            entry.alive.store(false, Ordering::Relaxed);
        }
    }
}

fn is_git_meta_path(path: &Path, git_dir: &Path) -> bool {
    if !path.starts_with(git_dir) {
        return false;
    }
    path.file_name().map_or(false, |name| {
        let dominated = name.to_string_lossy();
        dominated == "HEAD"
            || dominated == "index"
            || dominated == "COMMIT_EDITMSG"
            || dominated == "packed-refs"
            || dominated == "config"
            || dominated.starts_with("refs/")
            || dominated.starts_with("FETCH_")
            || dominated.starts_with("pull")
    })
}
