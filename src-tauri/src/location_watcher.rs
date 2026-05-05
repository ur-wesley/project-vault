use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use notify::{Event, RecursiveMode, Watcher};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::RwLock;

fn is_ignored_path(path: &std::path::Path) -> bool {
    let s = path.to_string_lossy();
    let ignored = [
        "/node_modules/",
        "/.git/",
        "/target/",
        "/.next/",
        "/dist/",
        "/build/",
        "/.turbo/",
        "/.cache/",
        "/.cargo/",
        "/vendor/",
        "/.parcel-cache/",
        "/.eslintcache/",
        "/.swc/",
        "/.idea/",
        "/.vscode/",
        "/coverage/",
        "/out/",
        "/bin/",
        "/obj/",
        "/tmp/",
        "/temp/",
        "/__pycache__/",
        "/.venv/",
        "/venv/",
        "/.nuxt/",
        "/.output/",
        "/.vercel/",
        "/.netlify/",
        "/playwright-report/",
        "/test-results/",
    ];
    ignored.iter().any(|p| s.contains(p))
}

fn event_depth(event_path: &Path, root_path: &Path) -> Option<usize> {
    let rel = event_path.strip_prefix(root_path).ok()?;
    Some(rel.components().count())
}

fn is_dir_or_unknown(path: &Path) -> bool {
    std::fs::metadata(path)
        .map(|m| m.is_dir())
        .unwrap_or(true)
}

#[derive(Clone)]
pub struct LocationWatcher {
    app: AppHandle,
    watchers: Arc<RwLock<HashMap<String, notify::RecommendedWatcher>>>,
    debounce_map: Arc<tokio::sync::Mutex<HashMap<String, tokio::time::Instant>>>,
    last_scan_time: Arc<tokio::sync::Mutex<HashMap<String, tokio::time::Instant>>>,
    scanning: Arc<tokio::sync::Mutex<HashSet<String>>>,
}

impl LocationWatcher {
    pub fn new(app: AppHandle) -> Self {
        let debounce_map: Arc<tokio::sync::Mutex<HashMap<String, tokio::time::Instant>>> =
            Arc::new(tokio::sync::Mutex::new(HashMap::new()));
        let last_scan_time: Arc<tokio::sync::Mutex<HashMap<String, tokio::time::Instant>>> =
            Arc::new(tokio::sync::Mutex::new(HashMap::new()));
        let scanning: Arc<tokio::sync::Mutex<HashSet<String>>> =
            Arc::new(tokio::sync::Mutex::new(HashSet::new()));

        let debounce_map_clone = debounce_map.clone();
        let last_scan_time_clone = last_scan_time.clone();
        let scanning_clone = scanning.clone();
        let app_clone = app.clone();

        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(1)).await;
                let mut map = debounce_map_clone.lock().await;
                let now = tokio::time::Instant::now();
                let ready: Vec<String> = map
                    .iter()
                    .filter(|(_, t)| **t <= now)
                    .map(|(id, _)| id.clone())
                    .collect();

                for loc_id in ready {
                    map.remove(&loc_id);

                    // Check cooldown: max 1 scan per location per 60s
                    let last_map = last_scan_time_clone.lock().await;
                    let cooldown_ok = last_map
                        .get(&loc_id)
                        .map(|t| now.duration_since(*t) >= Duration::from_secs(60))
                        .unwrap_or(true);
                    if !cooldown_ok {
                        continue;
                    }

                    // Check if already scanning this location
                    let mut scanning_set = scanning_clone.lock().await;
                    if scanning_set.contains(&loc_id) {
                        continue;
                    }
                    scanning_set.insert(loc_id.clone());
                    drop(scanning_set);
                    drop(last_map);

                    let app = app_clone.clone();
                    let scanning_clone2 = scanning_clone.clone();
                    let last_scan_time_clone2 = last_scan_time_clone.clone();
                    tauri::async_runtime::spawn(async move {
                        trigger_scan_for_location(app.clone(), loc_id.clone(), true).await;
                        let mut scanning_set = scanning_clone2.lock().await;
                        scanning_set.remove(&loc_id);
                        let mut last_map = last_scan_time_clone2.lock().await;
                        last_map.insert(loc_id, tokio::time::Instant::now());
                    });
                }
            }
        });

        Self {
            app,
            watchers: Arc::new(RwLock::new(HashMap::new())),
            debounce_map,
            last_scan_time,
            scanning,
        }
    }

    pub async fn watch(&self, location_id: String, path: String) -> Result<(), String> {
        self.unwatch(&location_id).await;

        let root_path = Path::new(&path).to_path_buf();
        let debounce_map = self.debounce_map.clone();
        let app = self.app.clone();
        let loc_id_for_closure = location_id.clone();

        let mut watcher = notify::recommended_watcher(
            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    match event.kind {
                        notify::EventKind::Create(_) | notify::EventKind::Remove(_) => {
                            let mut should_debounce = false;
                            for p in &event.paths {
                                if is_ignored_path(p) {
                                    continue;
                                }
                                let depth = event_depth(p, &root_path);
                                let depth_ok = depth.map(|d| d <= 2).unwrap_or(false);
                                if !depth_ok {
                                    continue;
                                }
                                // Only react to directories (or unknown, to be safe)
                                if is_dir_or_unknown(p) {
                                    should_debounce = true;
                                    break;
                                }
                            }
                            if should_debounce {
                                let map = debounce_map.clone();
                                let loc_id = loc_id_for_closure.clone();
                                let app_handle = app.clone();
                                tauri::async_runtime::spawn(async move {
                                    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
                                    let mut map = map.lock().await;
                                    map.insert(loc_id.clone(), deadline);
                                    drop(map);
                                    let _ = app_handle.emit(
                                        "location:fs-event",
                                        json!({ "locationId": loc_id }),
                                    );
                                });
                            }
                        }
                        _ => {}
                    }
                }
            },
        )
        .map_err(|e| format!("failed to create watcher: {e}"))?;

        watcher
            .watch(Path::new(&path), RecursiveMode::Recursive)
            .map_err(|e| format!("failed to watch path: {e}"))?;

        let mut watchers = self.watchers.write().await;
        watchers.insert(location_id, watcher);
        Ok(())
    }

    pub async fn unwatch(&self, location_id: &str) {
        let mut watchers = self.watchers.write().await;
        if let Some(w) = watchers.remove(location_id) {
            drop(w);
        }
        let mut map = self.debounce_map.lock().await;
        map.remove(location_id);
        let mut last_map = self.last_scan_time.lock().await;
        last_map.remove(location_id);
        let mut scanning = self.scanning.lock().await;
        scanning.remove(location_id);
    }

    pub async fn watch_all_enabled(&self) {
        let db = self.app.state::<tauri_plugin_sql::DbInstances>();
        let pool = match crate::db::sqlite_pool(&*db).await {
            Ok(p) => p,
            Err(e) => {
                eprintln!("[watcher] Failed to get DB pool: {:?}", e);
                return;
            }
        };
        let locs = match crate::db::list_locations(&pool).await {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[watcher] Failed to list locations: {:?}", e);
                return;
            }
        };
        for loc in locs {
            if loc.enabled {
                let _ = self.watch(loc.id.clone(), loc.path.clone()).await;
            }
        }
    }
}

async fn trigger_scan_for_location(app: AppHandle, location_id: String, lightweight: bool) {
    let db = app.state::<tauri_plugin_sql::DbInstances>();
    let pool = match crate::db::sqlite_pool(&*db).await {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[watcher] Failed to get DB pool for {}: {:?}", location_id, e);
            return;
        }
    };

    let loc = match crate::db::get_location(&pool, &location_id).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[watcher] Failed to get location {}: {:?}", location_id, e);
            return;
        }
    };

    if !loc.enabled {
        return;
    }

    if !Path::new(&loc.path).is_dir() {
        eprintln!(
            "[watcher] Location path does not exist, skipping scan: {}",
            loc.path
        );
        return;
    }

    let _ = app.emit(
        "location:scan-started",
        json!({ "locationId": location_id, "locationName": loc.name }),
    );

    let result = crate::commands::scan::run_location_scan_impl(app.clone(), location_id.clone(), lightweight).await;

    let payload = match &result {
        Ok(r) => json!({
            "locationId": location_id,
            "locationName": loc.name,
            "success": true,
            "projectsDiscovered": r.projects_discovered,
            "projectsUpserted": r.projects_upserted,
            "projectsPruned": r.projects_pruned,
        }),
        Err(e) => json!({
            "locationId": location_id,
            "locationName": loc.name,
            "success": false,
            "error": e.message,
        }),
    };

    let _ = app.emit("location:scan-completed", payload);
}
