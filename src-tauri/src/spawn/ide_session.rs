use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use sysinfo::{System, ProcessesToUpdate, Pid};
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
        let mut startup_grace_count = 0;

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
                
                for (pid, proc) in sys.processes() {
                    let name = proc.name().to_string_lossy();
                    if is_name_match(&name, &exe_name_h, &exe_stem_h) {
                        if is_project_match(proc, &target_path_norm) {
                            let new_pid = (*pid).as_u32();
                            current_pid = Some(new_pid);
                            still_running = true;
                            
                            // Update PID in map for stop_project_ide visibility
                            if let Ok(mut g) = sessions_h.0.lock() {
                                if let Some(s) = g.get_mut(&pid_h) {
                                    if s.session_id == sid_h {
                                        s.pid = Some(new_pid);
                                    }
                                }
                            }
                            break;
                        }
                    }
                }
            }

            if !still_running {
                if startup_grace_count < 10 { // 30 seconds initial grace
                    startup_grace_count += 1;
                    tokio::time::sleep(Duration::from_secs(3)).await;
                    continue;
                }
                break;
            }

            // Successfully tracked, we can slightly increase grace count to avoid immediate exit on next blip
            // but we don't want to stay stuck at high values forever.
            if startup_grace_count > 10 {
                startup_grace_count = 11; 
            } else {
                startup_grace_count += 1;
            }
            
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

fn is_name_match(name: &str, expected_name: &str, expected_stem: &str) -> bool {
    name.eq_ignore_ascii_case(expected_name) || 
    name.eq_ignore_ascii_case(expected_stem) ||
    name.to_lowercase().contains(&expected_stem.to_lowercase()) ||
    (cfg!(windows) && name.eq_ignore_ascii_case(&format!("{}.exe", expected_stem)))
}

fn is_project_match(proc: &sysinfo::Process, target_path_norm: &str) -> bool {
    // Check CWD (Strict match)
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
        // Check if the argument is exactly the path or contains it as a distinct part
        if arg_norm == target_path_norm || 
           arg_norm.contains(&format!("\"{}\"", target_path_norm)) ||
           arg_norm.contains(&format!("'{}'", target_path_norm)) ||
           arg_norm.ends_with(&format!("/{}", target_path_norm)) ||
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
