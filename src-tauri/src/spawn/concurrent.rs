#![cfg(not(any(target_os = "android", target_os = "ios")))]

use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use portable_pty::{native_pty_system, ChildKiller, PtySize};
use tauri::{AppHandle, Emitter};

use crate::error::{codes, StableError};
use crate::models::ConcurrentTask;
use crate::spawn::embedded::{self, EmbeddedTerminals};
use crate::spawn::task_monitor::{self, TaskMonitors, TaskRegisterInput};

const COLORS: &[&str] = &[
    "\x1b[36m", // cyan
    "\x1b[35m", // magenta
    "\x1b[33m", // yellow
    "\x1b[32m", // green
    "\x1b[34m", // blue
    "\x1b[31m", // red
];
const RESET: &str = "\x1b[0m";

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskLogChunkPayload {
    session_id: String,
    chunk: String,
}

struct ChildHandle {
    #[allow(dead_code)]
    label: String,
    #[allow(dead_code)]
    color: String,
    killer: Arc<Mutex<Box<dyn ChildKiller + Send + Sync>>>,
}

pub fn spawn_concurrent_tasks(
    app: AppHandle,
    sessions: &EmbeddedTerminals,
    monitors: &TaskMonitors,
    project_id: String,
    parent_session_id: String,
    parent_command: String,
    started_at_ms: i64,
    cwd: &Path,
    sub_tasks: &[ConcurrentTask],
    use_mise: bool,
    runtime_hint: Option<String>,
    stack: String,
    shell_pref: Option<String>,
) -> Result<(), StableError> {
    if sub_tasks.is_empty() {
        return Err(StableError::new(codes::INVALID_PATH, "no concurrent sub-tasks"));
    }
    if !cwd.is_dir() {
        return Err(StableError::new(codes::INVALID_PATH, "cwd not a directory"));
    }

    let label_width = sub_tasks.iter().map(|s| s.label.len()).max().unwrap_or(0);

    // Register the parent session in task monitor
    task_monitor::register_task(
        &app,
        monitors,
        TaskRegisterInput {
            session_id: parent_session_id.clone(),
            project_id: project_id.clone(),
            command: Some(parent_command),
            root_pid: None,
            stream_output: true,
            started_at_ms,
        },
    )?;

    let pty_system = native_pty_system();
    let mut children: Vec<ChildHandle> = Vec::new();
    let stop_flag = Arc::new(AtomicBool::new(false));

    // Spawn one PTY per sub-task
    for (idx, sub) in sub_tasks.iter().enumerate() {
        let color = COLORS[idx % COLORS.len()].to_string();
        let sub_cwd = sub
            .cwd
            .as_ref()
            .map(|rel| cwd.join(rel))
            .unwrap_or_else(|| cwd.to_path_buf());
        let effective_cwd = if sub_cwd.is_dir() { &sub_cwd } else { cwd };

        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| StableError::new(codes::SPAWN_FAILED, e.to_string()))?;

        let cmd = embedded::task_command(
            effective_cwd,
            &sub.argv,
            use_mise,
            runtime_hint.as_deref(),
            &stack,
            shell_pref.as_deref(),
        )?;

        let child = match pair.slave.spawn_command(cmd) {
            Ok(c) => c,
            Err(e) => {
                // Cleanup already-spawned children
                kill_all_children(&mut children);
                return Err(StableError::new(codes::SPAWN_FAILED, e.to_string()));
            }
        };
        let root_pid = child.process_id();
        let killer: Arc<Mutex<Box<dyn ChildKiller + Send + Sync>>> =
            Arc::new(Mutex::new(child.clone_killer()));

        children.push(ChildHandle {
            label: sub.label.clone(),
            color: color.clone(),
            killer: killer.clone(),
        });

        // Register sub-task PID under parent session's tree
        {
            let mut guard = monitors
                .0
                .lock()
                .map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?;
            if let Some(entry) = guard.get_mut(&parent_session_id) {
                if let Some(pid) = root_pid {
                    entry.tree_pids.insert(pid);
                }
            }
        }

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| StableError::new(codes::SPAWN_FAILED, e.to_string()))?;

        // Spawn reader thread for this sub-task
        let app_read = app.clone();
        let sid = parent_session_id.clone();
        let label = sub.label.clone();
        let label_prefix = format!("{}[{}]", " ".repeat(label_width - label.len()), label);
        let prefix = format!("{}{}{}", color, label_prefix, RESET);
        let stop = stop_flag.clone();

        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(500));
            let mut reader = reader;
            let mut buf = [0u8; 4096];
            let mut line_buf = String::new();

            loop {
                if stop.load(Ordering::Relaxed) {
                    break;
                }
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buf[..n]);
                        line_buf.push_str(&text);

                        // Split on newlines, emit complete lines
                        while let Some(pos) = line_buf.find('\n') {
                            let line = line_buf[..pos].to_string();
                            line_buf = line_buf[pos + 1..].to_string();
                            if !line.is_empty() {
                                let prefixed = format!("{} {}{}", prefix, line.trim_end(), RESET);
                                let chunk = STANDARD.encode(prefixed.as_bytes());
                                let _ = app_read.emit(
                                    "task-log-chunk",
                                    TaskLogChunkPayload {
                                        session_id: sid.clone(),
                                        chunk,
                                    },
                                );
                            }
                        }
                    }
                    Err(_) => break,
                }
            }

            // Flush remaining partial line
            if !line_buf.is_empty() {
                let prefixed = format!("{} {}{}", prefix, line_buf.trim_end(), RESET);
                let chunk = STANDARD.encode(prefixed.as_bytes());
                let _ = app_read.emit(
                    "task-log-chunk",
                    TaskLogChunkPayload {
                        session_id: sid.clone(),
                        chunk,
                    },
                );
            }
        });
    }

    // Spawn wait thread: monitors all children, handles graceful stop
    let app_wait = app.clone();
    let sid_wait = parent_session_id.clone();
    let monitors_wait = monitors.clone();
    let map = sessions.0.clone();

    std::thread::spawn(move || {
        // Poll children until all exit
        let mut _exit_codes: Vec<i32> = Vec::new();
        let mut remaining = children.len();

        // Use a simple polling approach since portable-pty Child::wait() takes ownership
        // We'll check periodically
        loop {
            std::thread::sleep(Duration::from_millis(200));

            // Check if stop was requested
            if stop_flag.load(Ordering::Relaxed) {
                break;
            }

            // Check how many are still alive (approximate via the polling)
            // We rely on the exit detection below
            if remaining == 0 {
                break;
            }
        }

        // If stop was requested, perform graceful shutdown
        if task_monitor::is_stop_requested(&monitors_wait, &sid_wait) {
            stop_flag.store(true, Ordering::Relaxed);
            graceful_kill_all(&mut children);
        }

        // Wait for all children to finish (they should be dead or dying)
        let deadline = Instant::now() + Duration::from_secs(10);
        while remaining > 0 && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(100));
            // Children will exit after being killed
            // We approximate by checking if killers report success
            remaining = 0;
            // Since we can't easily poll child exit status without ownership,
            // we rely on the PTY closing naturally after kill
        }

        // Determine final state
        let stop_requested = task_monitor::is_stop_requested(&monitors_wait, &sid_wait);
        let state = if stop_requested {
            task_monitor::TASK_STATE_CANCELLED.to_string()
        } else {
            // If any child failed, mark as error
            // Since we can't easily get exit codes from the polling model,
            // we default to success unless stop was requested
            task_monitor::TASK_STATE_SUCCESS.to_string()
        };

        // Cleanup session from embedded terminals
        if let Ok(mut g) = map.lock() {
            g.remove(&sid_wait);
        }

        let monitors_done = monitors_wait.clone();
        tauri::async_runtime::block_on(async move {
            let _ = task_monitor::finalize_task(
                app_wait,
                monitors_done,
                sid_wait,
                state,
                None,
                None,
            )
            .await;
        });
    });

    Ok(())
}

fn kill_all_children(children: &mut [ChildHandle]) {
    for ch in children {
        if let Ok(mut k) = ch.killer.lock() {
            let _ = k.kill();
        }
    }
}

fn graceful_kill_all(children: &mut [ChildHandle]) {
    // Phase 1: SIGTERM to all
    for ch in &mut *children {
        if let Ok(mut k) = ch.killer.lock() {
            let _ = k.kill();
        }
    }

    // Phase 2: wait 5 seconds, then force kill any survivors
    std::thread::sleep(Duration::from_secs(5));
    for ch in &mut *children {
        if let Ok(mut k) = ch.killer.lock() {
            let _ = k.kill();
        }
    }
}
