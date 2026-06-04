use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use serde_json::json;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

struct WatcherEntry {
    alive: Arc<AtomicBool>,
    projects: Arc<std::sync::Mutex<HashSet<String>>>,
}

pub struct GitWatcher {
    app: AppHandle,
    watchers: Arc<Mutex<HashMap<PathBuf, Arc<WatcherEntry>>>>,
}

impl GitWatcher {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            watchers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn start(&self, project_id: &str, project_path: &str) -> Result<(), String> {
        // First, stop watching this project_id on any existing watchers
        self.stop(project_id).await;

        let git_dir = crate::commands::git::utils::resolve_git_dir(Path::new(project_path))
            .ok_or_else(|| format!("no git directory found for {project_path}"))?;
        
        let git_dir_canonical = std::fs::canonicalize(&git_dir)
            .unwrap_or_else(|_| git_dir.clone());

        let mut map = self.watchers.lock().await;

        if let Some(entry) = map.get(&git_dir_canonical) {
            // Already watching this git directory! Just subscribe the new project ID.
            entry.projects.lock().unwrap().insert(project_id.to_string());
            entry.alive.store(true, Ordering::Relaxed);
            return Ok(());
        }

        let pid = project_id.to_string();
        let alive = Arc::new(AtomicBool::new(true));
        let alive_clone = alive.clone();
        
        let projects = Arc::new(std::sync::Mutex::new(HashSet::new()));
        projects.lock().unwrap().insert(pid);
        let projects_clone = projects.clone();

        let app = self.app.clone();
        let target_git_dir = git_dir_canonical.clone();

        // Spawn a safe, lightweight polling task instead of using notify OS file hooks
        tokio::spawn(async move {
            let mut last_mtime = get_git_mtime(&target_git_dir).await;
            
            while alive_clone.load(Ordering::Relaxed) {
                tokio::time::sleep(Duration::from_millis(1500)).await;
                
                if !alive_clone.load(Ordering::Relaxed) {
                    break;
                }
                
                let current_mtime = get_git_mtime(&target_git_dir).await;
                if current_mtime != last_mtime {
                    last_mtime = current_mtime;
                    
                    let pids: Vec<String> = projects_clone.lock().unwrap().iter().cloned().collect();
                    for pid in pids {
                        let _ = app.emit("git:changed", json!({ "projectId": pid }));
                    }
                }
            }
        });

        let entry = Arc::new(WatcherEntry {
            alive,
            projects,
        });

        map.insert(git_dir_canonical, entry);

        Ok(())
    }

    pub async fn stop(&self, project_id: &str) {
        let mut map = self.watchers.lock().await;
        let mut to_remove = Vec::new();

        for (path, entry) in map.iter() {
            let mut projs = entry.projects.lock().unwrap();
            projs.remove(project_id);
            if projs.is_empty() {
                to_remove.push(path.clone());
                entry.alive.store(false, Ordering::Relaxed);
            }
        }

        for path in to_remove {
            map.remove(&path);
        }
    }
}

async fn get_git_mtime(git_dir: &Path) -> Option<SystemTime> {
    let mut max_time = None;
    if !git_dir.exists() {
        return None;
    }

    // Fast walkthrough of git directory metadata, skipping large objects and hooks subdirectories
    let walker = walkdir::WalkDir::new(git_dir)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            name != "objects" && name != "hooks" && name != "info" && name != "logs"
        });

    for entry in walker.filter_map(Result::ok) {
        if entry.file_type().is_file() {
            if let Ok(meta) = entry.metadata() {
                if let Ok(mtime) = meta.modified() {
                    max_time = Some(max_time.map_or(mtime, |max| std::cmp::max(max, mtime)));
                }
            }
        }
    }
    
    max_time
}
