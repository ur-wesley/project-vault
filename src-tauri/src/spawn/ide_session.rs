use std::collections::{HashMap, HashSet, VecDeque};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use sysinfo::{Process, System, ProcessesToUpdate, Pid};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::error::{codes, StableError};
use crate::ide;

pub struct IdeSession {
    pub session_id: String,
    pub pid: Option<u32>,
}

#[derive(Clone, Default)]
pub struct ProjectIdeSessions(pub Arc<Mutex<HashMap<String, IdeSession>>>);

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct IdeStateEmit {
    project_id: String,
    running: bool,
}

pub async fn start_ide_session(
    app: AppHandle,
    sessions: &ProjectIdeSessions,
    project_id: String,
    executable: String,
) -> Result<(), StableError> {
    // 1. Prevent duplicates
    {
        let g = sessions.0.lock().unwrap();
        if g.contains_key(&project_id) {
            return Ok(());
        }
    }

    // 2. Load Project Info
    let db = app.state::<DbInstances>();
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &project_id).await?;
    let project_path = project.path.clone();
    
    // 3. Identify Names
    let exe_path = Path::new(&executable);
    let exe_name = exe_path.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "IDE".to_string());
    let exe_stem = exe_path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "IDE".to_string());

    // 4. Launch IDE
    let child = ide::launch_ide(&executable, Path::new(&project_path))?;
    let initial_pid = child.id();

    // 5. Create DB Session
    let db_session = db::start_session(&pool, &project_id, Some(format!("IDE: {exe_stem}")), None).await?;
    let session_id = db_session.id;

    // 5.5 Update project's last_opened_at_ms
    let _ = db::touch_project_opened(&pool, &project_id).await;

    // 6. Register Session
    {
        let mut g = sessions.0.lock().unwrap();
        g.insert(
            project_id.clone(),
            IdeSession {
                session_id: session_id.clone(),
                pid: Some(initial_pid),
            },
        );
    }

    // 7. Emit State (Running)
    let _ = app.emit("ide-state-changed", IdeStateEmit { project_id: project_id.clone(), running: true });

    // 8. Spawn Watcher (Async Task)
    let app_h = app.clone();
    let sessions_h = sessions.clone();
    let pid_h = project_id.clone();
    let sid_h = session_id.clone();
    let target_path_h = project_path.clone();
    let exe_name_h = exe_name.clone();
    let exe_stem_h = exe_stem.clone();

    tauri::async_runtime::spawn(async move {
        let mut sys = System::new_all();
        let target_path = Path::new(&target_path_h);
        let target_path_canonical = dunce::canonicalize(target_path).unwrap_or_else(|_| target_path.to_path_buf());
        let target_path_norm = target_path_canonical.to_string_lossy().to_lowercase().replace('\\', "/");
        
        let mut current_pid: Option<u32> = Some(initial_pid);
        let mut confirmed_alive = false;
        let mut startup_grace_count: u32 = 0;
        let mut known_pids: HashSet<u32> = HashSet::new();
        known_pids.insert(initial_pid);

        loop {
            // Check session validity
            {
                let g = sessions_h.0.lock().unwrap();
                match g.get(&pid_h) {
                    Some(s) if s.session_id == sid_h => {
                        // Current session is still ours
                    },
                    Some(_s) => {
                        break;
                    },
                    None => {
                        break;
                    }
                }
            }

            let mut still_running = false;

            // Strategy 1: Check tracked PID
            if let Some(pid) = current_pid {
                sys.refresh_processes(ProcessesToUpdate::Some(&[Pid::from(pid as usize)]), true);
                if let Some(proc) = sys.process(Pid::from(pid as usize)) {
                    let name = proc.name().to_string_lossy();
                    let matches = is_name_match(&name, &exe_name_h, &exe_stem_h);
                    if matches {
                        still_running = true;
                        confirmed_alive = true;
                    } else {
                        current_pid = None;
                    }
                } else {
                    // PID died
                    current_pid = None;
                }
            }

            // Strategy 2: Full Scan
            if !still_running {
                sys.refresh_processes(ProcessesToUpdate::All, true);

                let fallback = if confirmed_alive || startup_grace_count < 15 {
                    // If we previously found the IDE, or we're still in startup grace,
                    // be more lenient: accept name-only match if strict match fails.
                    FallbackMode::Lenient
                } else {
                    FallbackMode::Strict
                };

                if let Some((new_pid, strict)) = find_ide_process(
                    &sys,
                    &exe_name_h,
                    &exe_stem_h,
                    &target_path_norm,
                    &known_pids,
                    fallback,
                ) {
                    current_pid = Some(new_pid);
                    still_running = true;
                    if strict {
                        confirmed_alive = true;
                    }
                    known_pids.insert(new_pid);
                    
                    // Update PID in map for stop_project_ide visibility
                    if let Ok(mut g) = sessions_h.0.lock() {
                        if let Some(s) = g.get_mut(&pid_h) {
                            if s.session_id == sid_h {
                                s.pid = Some(new_pid);
                            }
                        }
                    }
                }
            }

            if !still_running {
                if startup_grace_count < 15 { // 45 seconds initial grace
                    startup_grace_count += 1;
                    tokio::time::sleep(Duration::from_secs(3)).await;
                    continue;
                }
                break;
            }

            startup_grace_count = startup_grace_count.saturating_add(1).min(16);
            tokio::time::sleep(Duration::from_secs(5)).await;
        }

        // Cleanup
        {
            let mut g = sessions_h.0.lock().unwrap();
            if let Some(s) = g.get(&pid_h) {
                if s.session_id == sid_h {
                    g.remove(&pid_h);
                }
            }
        }

        // Emit State (Stopped)
        let _ = app_h.emit("ide-state-changed", IdeStateEmit { project_id: pid_h.clone(), running: false });

        // End DB Session
        let db = app_h.state::<DbInstances>();
        if let Ok(pool) = db::sqlite_pool(&*db).await {
            let _ = db::end_session(&pool, &sid_h).await;
        }
    });

    Ok(())
}

#[derive(Clone, Copy)]
enum FallbackMode {
    Strict,
    Lenient,
}

fn find_ide_process(
    sys: &System,
    exe_name: &str,
    exe_stem: &str,
    target_path_norm: &str,
    known_pids: &HashSet<u32>,
    fallback: FallbackMode,
) -> Option<(u32, bool)> {
    // Build parent index once for this scan
    let mut children_by_parent: HashMap<u32, Vec<u32>> = HashMap::new();
    for (pid, proc) in sys.processes() {
        if let Some(parent) = proc.parent() {
            children_by_parent
                .entry(parent.as_u32())
                .or_default()
                .push(pid.as_u32());
        }
    }

    // --- Pass 1: strict match (name + project path) ---
    for (pid, proc) in sys.processes() {
        let name = proc.name().to_string_lossy();
        if is_name_match(&name, exe_name, exe_stem) {
            if is_project_match(proc, target_path_norm) {
                return Some((pid.as_u32(), true));
            }
        }
    }

    // --- Pass 2: check if any known PID spawned a child that matches by name ---
    for known in known_pids {
        let mut queue: VecDeque<u32> = VecDeque::new();
        queue.push_back(*known);
        let mut visited = HashSet::new();
        visited.insert(*known);

        while let Some(pid) = queue.pop_front() {
            if let Some(children) = children_by_parent.get(&pid) {
                for &child_pid in children {
                    if !visited.insert(child_pid) {
                        continue;
                    }
                    if let Some(proc) = sys.process(Pid::from(child_pid as usize)) {
                        let name = proc.name().to_string_lossy();
                        if is_name_match(&name, exe_name, exe_stem) {
                            return Some((child_pid, true));
                        }
                    }
                    queue.push_back(child_pid);
                }
            }
        }
    }

    // --- Pass 3: lenient fallback (any process matching by name) ---
    if matches!(fallback, FallbackMode::Lenient) {
        for (pid, proc) in sys.processes() {
            let name = proc.name().to_string_lossy();
            if is_name_match(&name, exe_name, exe_stem) {
                return Some((pid.as_u32(), false));
            }
        }
    }

    None
}

fn is_name_match(name: &str, expected_name: &str, expected_stem: &str) -> bool {
    let name_lower = name.to_lowercase();
    let stem_lower = expected_stem.to_lowercase();
    name.eq_ignore_ascii_case(expected_name) || 
    name.eq_ignore_ascii_case(expected_stem) ||
    name_lower.contains(&stem_lower) ||
    stem_lower.contains(&name_lower) ||
    (cfg!(windows) && name.eq_ignore_ascii_case(&format!("{}.exe", expected_stem)))
}

fn is_project_match(proc: &Process, target_path_norm: &str) -> bool {
    // Check CWD (strict match)
    if let Some(cwd) = proc.cwd() {
        let cwd_canonical = dunce::canonicalize(cwd).unwrap_or_else(|_| cwd.to_path_buf());
        let cwd_norm = cwd_canonical.to_string_lossy().to_lowercase().replace('\\', "/");
        if cwd_norm == target_path_norm {
            return true;
        }
    }
    
    // Check Cmdline
    for arg in proc.cmd() {
        let arg_norm = arg.to_string_lossy().to_lowercase().replace('\\', "/");
        if arg_norm == target_path_norm || 
           arg_norm.contains(target_path_norm) ||
           arg_norm.contains(&format!("\"{}\"", target_path_norm)) ||
           arg_norm.contains(&format!("'{}'", target_path_norm)) ||
           arg_norm.contains(&format!("={}", target_path_norm))
        {
            return true;
        }
    }
    
    false
}

pub fn stop_ide_session(sessions: &ProjectIdeSessions, project_id: &str) -> Result<(), StableError> {
    let mut g = sessions.0.lock().map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?;
    if let Some(session) = g.remove(project_id) {
        if let Some(pid) = session.pid {
            let mut sys = System::new();
            let p = Pid::from(pid as usize);
            sys.refresh_processes(ProcessesToUpdate::Some(&[p]), true);
            if let Some(proc) = sys.process(p) {
                proc.kill();
            }
        }
    }
    Ok(())
}

pub fn is_ide_running(sessions: &ProjectIdeSessions, project_id: &str) -> bool {
    let g = sessions.0.lock().unwrap();
    g.contains_key(project_id)
}

pub fn list_running_project_ids(sessions: &ProjectIdeSessions) -> Vec<String> {
    let g = sessions.0.lock().unwrap();
    g.keys().cloned().collect()
}
