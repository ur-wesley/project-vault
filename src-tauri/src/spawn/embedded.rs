#![cfg(not(any(target_os = "android", target_os = "ios")))]

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::error::{codes, StableError};
use crate::spawn::resolve::get_mise_tool_args;
use crate::spawn::task_monitor::{self, TaskMonitors, TaskRegisterInput};

#[cfg(windows)]
fn is_terminal_launcher(path: &str) -> bool {
    let name = Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path)
        .to_ascii_lowercase();
    matches!(
        name.as_str(),
        "wt" | "wt.exe" | "openconsole" | "openconsole.exe" | "conhost" | "conhost.exe"
            | "windowsterminal" | "windowsterminal.exe"
    )
}

#[cfg(not(windows))]
fn is_terminal_launcher(_path: &str) -> bool {
    false
}

const TERMINAL_BUFFER_MAX: usize = 5000;

#[derive(Clone, Default)]
pub struct EmbeddedTerminals(pub Arc<Mutex<HashMap<String, EmbeddedSession>>>);

#[derive(Clone, Default)]
pub struct TerminalBuffers(pub Arc<Mutex<HashMap<String, Vec<String>>>>);

impl TerminalBuffers {
    pub fn append(&self, session_id: &str, chunk: &str) {
        if let Ok(mut g) = self.0.lock() {
            let buf = g.entry(session_id.to_string()).or_insert_with(Vec::new);
            buf.push(chunk.to_string());
            if buf.len() > TERMINAL_BUFFER_MAX {
                buf.remove(0);
            }
        }
    }

    pub fn get(&self, session_id: &str) -> Vec<String> {
        self.0
            .lock()
            .ok()
            .and_then(|g| g.get(session_id).cloned())
            .unwrap_or_default()
    }

    pub fn clear(&self, session_id: &str) {
        if let Ok(mut g) = self.0.lock() {
            g.remove(session_id);
        }
    }
}

pub fn is_session_alive(sessions: &EmbeddedTerminals, session_id: &str) -> bool {
    sessions
        .0
        .lock()
        .ok()
        .map(|g| g.contains_key(session_id))
        .unwrap_or(false)
}

pub fn get_terminal_buffer(buffers: &TerminalBuffers, session_id: &str) -> Vec<String> {
    buffers.get(session_id)
}

#[derive(Clone)]
pub struct EmbeddedSession {
    pub master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub killer: Arc<Mutex<Box<dyn ChildKiller + Send + Sync>>>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TermPayload {
    session_id: String,
    chunk: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TermExitPayload {
    session_id: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskLogChunkPayload {
    session_id: String,
    chunk: String,
}

#[cfg(windows)]
fn needs_shell_wrapper(args: &[String]) -> bool {
    for arg in args {
        if arg.contains('|')
            || arg.contains('>')
            || arg.contains('<')
            || arg.contains("&&")
            || arg.contains("||")
        {
            return true;
        }
    }
    false
}

#[cfg(windows)]
fn should_use_shell_wrapper(args: &[String], shell_pref: Option<&str>) -> bool {
    if needs_shell_wrapper(args) {
        return true;
    }
    if let Some(s) = shell_pref {
        let s = s.trim();
        if !s.is_empty() && Path::new(s).exists() && !is_terminal_launcher(s) {
            let s_low = s.to_lowercase();
            let is_default_cmd = s_low.ends_with("cmd.exe") || s_low == "cmd";
            return !is_default_cmd;
        }
    }
    false
}

#[cfg(windows)]
fn task_command_windows_shell_wrap(
    cwd: &Path,
    args: &[String],
    shell_pref: Option<&str>,
) -> Result<CommandBuilder, StableError> {
    let joined_cmd = args
        .iter()
        .map(|a| {
            if a.contains(' ') || a.contains('"') {
                format!("\"{}\"", a.replace("\"", "\"\""))
            } else {
                a.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(" ");

    let shell = if let Some(s) = shell_pref {
        if Path::new(s).exists() && !is_terminal_launcher(s) {
            s.to_string()
        } else {
            "cmd.exe".to_string()
        }
    } else {
        "cmd.exe".to_string()
    };

    let mut cb = CommandBuilder::new(&shell);
    let s_low = shell.to_lowercase();
    if s_low.contains("powershell") || s_low.contains("pwsh") {
        cb.arg("-ExecutionPolicy");
        cb.arg("Bypass");
        cb.arg("-Command");
        cb.arg(&joined_cmd);
    } else if s_low.contains("cmd.exe") || s_low == "cmd" {
        cb.arg("/D");
        cb.arg("/S");
        cb.arg("/C");
        cb.arg(&joined_cmd);
    } else {
        cb.arg("-c");
        cb.arg(&joined_cmd);
    }

    cb.cwd(cwd);
    Ok(cb)
}

#[cfg(windows)]
fn task_command_windows(
    cwd: &Path,
    argv: &[String],
    use_mise: bool,
    runtime_hint: Option<&str>,
    stack: &str,
    shell_pref: Option<&str>,
) -> Result<CommandBuilder, StableError> {
    let args = if use_mise {
        if argv.first().map(|s| s.as_str()) == Some("mise") {
            argv.to_vec()
        } else {
            get_mise_tool_args(runtime_hint, stack, argv)
        }
    } else {
        argv.to_vec()
    };

    if !args.is_empty() && !should_use_shell_wrapper(&args, shell_pref) {
        let os_args: Vec<std::ffi::OsString> = args.into_iter().map(Into::into).collect();
        let mut cb = CommandBuilder::from_argv(os_args);
        cb.cwd(cwd);
        return Ok(cb);
    }

    task_command_windows_shell_wrap(cwd, &args, shell_pref)
}

#[cfg(not(windows))]
fn sh_single_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\"'\"'"))
}

#[cfg(not(windows))]
fn task_command_unix(
    cwd: &Path,
    argv: &[String],
    use_mise: bool,
    runtime_hint: Option<&str>,
    stack: &str,
    shell_pref: Option<&str>,
) -> Result<CommandBuilder, StableError> {
    let args = if use_mise {
        if argv.get(0).map(|s| s.as_str()) == Some("mise") {
            argv.to_vec()
        } else {
            get_mise_tool_args(runtime_hint, stack, argv)
        }
    } else {
        argv.to_vec()
    };

    let mut c = CommandBuilder::new(shell_pref.as_deref().unwrap_or("sh"));
    c.cwd(cwd);
    c.arg("-c");
    
    // For sh -c, we need to join the arguments into a single string.
    // To handle spaces in arguments, we wrap each argument in single quotes.
    let cmd_line = args.iter()
        .map(|a| sh_single_quote(a))
        .collect::<Vec<_>>()
        .join(" ");
    c.arg(cmd_line);
    
    Ok(c)
}

pub fn task_command(
    cwd: &Path,
    argv: &[String],
    use_mise: bool,
    runtime_hint: Option<&str>,
    stack: &str,
    shell_pref: Option<&str>,
) -> Result<CommandBuilder, StableError> {
    #[cfg(windows)]
    {
        task_command_windows(cwd, argv, use_mise, runtime_hint, stack, shell_pref)
    }
    #[cfg(not(windows))]
    {
        task_command_unix(cwd, argv, use_mise, runtime_hint, stack, shell_pref)
    }
}

pub fn spawn_task_in_pty(
    app: AppHandle,
    sessions: &EmbeddedTerminals,
    buffers: &TerminalBuffers,
    monitors: &TaskMonitors,
    project_id: String,
    command_line: Option<String>,
    started_at_ms: i64,
    cwd: &Path,
    argv: &[String],
    use_mise: bool,
    stream_session_id: String,
    runtime_hint: Option<String>,
    stack: String,
    shell_pref: Option<String>,
) -> Result<(), StableError> {
    if !cwd.is_dir() {
        return Err(StableError::new(codes::INVALID_PATH, "cwd not a directory"));
    }
    if argv.is_empty() {
        return Err(StableError::new(codes::INVALID_PATH, "argv empty"));
    }
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| StableError::new(codes::SPAWN_FAILED, e.to_string()))?;

    let cmd = task_command(cwd, argv, use_mise, runtime_hint.as_deref(), &stack, shell_pref.as_deref())?;
    
    let mut child = match pair.slave.spawn_command(cmd) {
        Ok(c) => c,
        Err(e) => {
            return Err(StableError::new(codes::SPAWN_FAILED, e.to_string()));
        }
    };
    let root_pid = child.process_id();

    task_monitor::register_task(
        &app,
        monitors,
        TaskRegisterInput {
            session_id: stream_session_id.clone(),
            project_id,
            command: command_line,
            root_pid,
            stream_output: true,
            started_at_ms,
        },
    )?;
    
    let killer = Arc::new(Mutex::new(child.clone_killer()));
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| StableError::new(codes::SPAWN_FAILED, e.to_string()))?;
    let writer =
        Arc::new(Mutex::new(pair.master.take_writer().map_err(|e| {
            StableError::new(codes::SPAWN_FAILED, e.to_string())
        })?));
    let master = Arc::new(Mutex::new(pair.master));

    let sess = EmbeddedSession {
        master,
        writer,
        killer,
    };
    sessions
        .0
        .lock()
        .map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?
        .insert(stream_session_id.clone(), sess);

    let app_read = app.clone();
    let sid_read = stream_session_id.clone();
    let buffers_read = buffers.clone();
    let reader_thread = std::thread::spawn(move || {
        // Give frontend time to mount and start listening
        std::thread::sleep(std::time::Duration::from_millis(100));
        
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    break;
                },
                Ok(n) => {
                    let chunk = STANDARD.encode(&buf[..n]);
                    buffers_read.append(&sid_read, &chunk);
                    let task_chunk = chunk.clone();
                    let _ = app_read.emit(
                        "embedded-terminal-data",
                        TermPayload {
                            session_id: sid_read.clone(),
                            chunk,
                        },
                    );
                    let _ = app_read.emit(
                        "task-log-chunk",
                        TaskLogChunkPayload {
                            session_id: sid_read.clone(),
                            chunk: task_chunk,
                        },
                    );
                }
                Err(_e) => {
                    break;
                },
            }
        }
    });

    let app_wait = app.clone();
    let sid_wait = stream_session_id.clone();
    let map = sessions.0.clone();
    let monitors_wait = monitors.clone();
    std::thread::spawn(move || {
        let wait_res = child.wait();
        let _ = reader_thread.join();
        let stop_requested = task_monitor::is_stop_requested(&monitors_wait, &sid_wait);
        let (state, exit_code, stop_reason) = match wait_res {
            Ok(status) => {
                let signal_reason = status.signal().map(|s| format!("signal {s}"));
                let final_reason = if stop_requested {
                    Some("stop requested".to_string())
                } else {
                    signal_reason
                };
                let state = if stop_requested {
                    task_monitor::TASK_STATE_CANCELLED.to_string()
                } else if status.success() {
                    task_monitor::TASK_STATE_SUCCESS.to_string()
                } else {
                    task_monitor::TASK_STATE_ERROR.to_string()
                };
                let exit_code = Some(status.exit_code() as i32);
                (state, exit_code, final_reason)
            }
            Err(e) => (
                task_monitor::TASK_STATE_ERROR.to_string(),
                None,
                Some(e.to_string()),
            ),
        };

        if let Ok(mut g) = map.lock() {
            g.remove(&sid_wait);
        }
        let _ = app_wait.emit(
            "embedded-terminal-exit",
            TermExitPayload {
                session_id: sid_wait.clone(),
            },
        );
        let monitors_done = monitors_wait.clone();
        tauri::async_runtime::block_on(async move {
            let _ = task_monitor::finalize_task(
                app_wait,
                monitors_done,
                sid_wait,
                state,
                exit_code,
                stop_reason,
            )
            .await;
        });
    });

    Ok(())
}

fn shell_command(shell_pref: Option<&str>, cwd: &Path) -> Result<CommandBuilder, StableError> {
    if let Some(p) = shell_pref {
        let p = p.trim();
        if !p.is_empty() && !is_terminal_launcher(p) {
            let mut c = CommandBuilder::new(p);
            c.cwd(cwd);
            return Ok(c);
        }
    }
    #[cfg(windows)]
    {
        let mut c = CommandBuilder::new("cmd.exe");
        c.cwd(cwd);
        return Ok(c);
    }
    #[cfg(not(windows))]
    {
        let sh = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        let mut c = CommandBuilder::new(&sh);
        c.cwd(cwd);
        Ok(c)
    }
}

pub fn spawn_session(
    app: AppHandle,
    sessions: &EmbeddedTerminals,
    buffers: &TerminalBuffers,
    cwd: std::path::PathBuf,
    shell_pref: Option<String>,
) -> Result<String, StableError> {
    if !cwd.is_dir() {
        return Err(StableError::new(codes::INVALID_PATH, "cwd not a directory"));
    }
    let session_id = Uuid::new_v4().to_string();
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| StableError::new(codes::SPAWN_FAILED, e.to_string()))?;

    let cmd = shell_command(shell_pref.as_deref(), &cwd)?;
    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| StableError::new(codes::SPAWN_FAILED, e.to_string()))?;
    let killer = Arc::new(Mutex::new(child.clone_killer()));
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| StableError::new(codes::SPAWN_FAILED, e.to_string()))?;
    let writer =
        Arc::new(Mutex::new(pair.master.take_writer().map_err(|e| {
            StableError::new(codes::SPAWN_FAILED, e.to_string())
        })?));
    let master = Arc::new(Mutex::new(pair.master));

    let sess = EmbeddedSession {
        master,
        writer,
        killer,
    };
    sessions
        .0
        .lock()
        .map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?
        .insert(session_id.clone(), sess);

    let app_read = app.clone();
    let sid_read = session_id.clone();
    let buffers_read = buffers.clone();
    let reader_thread = std::thread::spawn(move || {
        // Give the frontend a moment to mount and start listening before
        // emitting data, otherwise early chunks (e.g. the shell prompt) may
        // be lost.
        std::thread::sleep(std::time::Duration::from_millis(100));
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = STANDARD.encode(&buf[..n]);
                    buffers_read.append(&sid_read, &chunk);
                    let _ = app_read.emit(
                        "embedded-terminal-data",
                        TermPayload {
                            session_id: sid_read.clone(),
                            chunk,
                        },
                    );
                }
                Err(_) => break,
            }
        }
    });

    let app_wait = app.clone();
    let sid_wait = session_id.clone();
    let map = sessions.0.clone();
    std::thread::spawn(move || {
        let _ = child.wait();
        let _ = reader_thread.join();
        if let Ok(mut g) = map.lock() {
            g.remove(&sid_wait);
        }
        let _ = app_wait.emit(
            "embedded-terminal-exit",
            TermExitPayload {
                session_id: sid_wait,
            },
        );
    });

    Ok(session_id)
}

pub fn write_session(
    sessions: &EmbeddedTerminals,
    session_id: &str,
    data: &str,
) -> Result<(), StableError> {
    let sess = {
        let g = sessions
            .0
            .lock()
            .map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?;
        match g.get(session_id).cloned() {
            Some(s) => s,
            None => return Ok(()), // concurrent task session — no-op
        }
    };
    let mut w = sess
        .writer
        .lock()
        .map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?;
    w.write_all(data.as_bytes())
        .map_err(|e| StableError::new(codes::SPAWN_FAILED, e.to_string()))?;
    let _ = w.flush();
    Ok(())
}

pub fn resize_session(
    sessions: &EmbeddedTerminals,
    session_id: &str,
    rows: u16,
    cols: u16,
) -> Result<(), StableError> {
    let sess = {
        let g = sessions
            .0
            .lock()
            .map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?;
        match g.get(session_id).cloned() {
            Some(s) => s,
            None => return Ok(()), // concurrent task session — no-op
        }
    };
    let m = sess
        .master
        .lock()
        .map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?;
    m.resize(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })
    .map_err(|e| StableError::new(codes::SPAWN_FAILED, e.to_string()))
}

pub fn kill_session(sessions: &EmbeddedTerminals, session_id: &str) -> Result<(), StableError> {
    let sess = {
        let mut g = sessions
            .0
            .lock()
            .map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?;
        g.remove(session_id)
    };
    if let Some(sess) = sess {
        let mut k = sess
            .killer
            .lock()
            .map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?;
        let _ = k.kill();
    }
    Ok(())
}
