#![cfg(not(any(target_os = "android", target_os = "ios")))]

use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

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

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TermPayload {
    session_id: String,
    chunk: String,
}

struct ChildHandle {
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
    let remaining = Arc::new(AtomicUsize::new(sub_tasks.len()));

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

        let mut child = match pair.slave.spawn_command(cmd) {
            Ok(c) => c,
            Err(e) => {
                kill_all_children(&mut children);
                return Err(StableError::new(codes::SPAWN_FAILED, e.to_string()));
            }
        };
        let root_pid = child.process_id();
        let killer: Arc<Mutex<Box<dyn ChildKiller + Send + Sync>>> =
            Arc::new(Mutex::new(child.clone_killer()));

        children.push(ChildHandle { killer: killer.clone() });

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
            // Give frontend time to mount and start listening
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

                        while let Some(pos) = line_buf.find('\n') {
                            let line = line_buf[..pos].to_string();
                            line_buf = line_buf[pos + 1..].to_string();
                            if !line.is_empty() {
                                let prefixed = format!("{} {}{}", prefix, line.trim_end(), RESET);
                                let chunk = STANDARD.encode(prefixed.as_bytes());
                                let _ = app_read.emit(
                                    "embedded-terminal-data",
                                    TermPayload {
                                        session_id: sid.clone(),
                                        chunk: chunk.clone(),
                                    },
                                );
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
                    "embedded-terminal-data",
                    TermPayload {
                        session_id: sid.clone(),
                        chunk: chunk.clone(),
                    },
                );
                let _ = app_read.emit(
                    "task-log-chunk",
                    TaskLogChunkPayload {
                        session_id: sid.clone(),
                        chunk,
                    },
                );
            }
        });

        // Spawn a dedicated thread to wait on this child's exit
        let remaining_clone = remaining.clone();
        std::thread::spawn(move || {
            let _ = child.wait();
            remaining_clone.fetch_sub(1, Ordering::SeqCst);
        });
    }

    // Spawn wait thread: monitors remaining count, handles graceful stop
    let app_wait = app.clone();
    let sid_wait = parent_session_id.clone();
    let monitors_wait = monitors.clone();
    let map = sessions.0.clone();

    std::thread::spawn(move || {
        // Wait until all children have exited
        while remaining.load(Ordering::SeqCst) > 0 {
            std::thread::sleep(Duration::from_millis(200));

            // Check if stop was requested
            if task_monitor::is_stop_requested(&monitors_wait, &sid_wait) {
                stop_flag.store(true, Ordering::Relaxed);
                graceful_kill_all(&mut children);
                break;
            }
        }

        // If we broke out due to stop, wait a bit more for children to die
        if stop_flag.load(Ordering::Relaxed) {
            let deadline = std::time::Instant::now() + Duration::from_secs(10);
            while remaining.load(Ordering::SeqCst) > 0 && std::time::Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(100));
            }
        }

        // Determine final state
        let stop_requested = task_monitor::is_stop_requested(&monitors_wait, &sid_wait);
        let state = if stop_requested {
            task_monitor::TASK_STATE_CANCELLED.to_string()
        } else {
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
