#![cfg(not(any(target_os = "android", target_os = "ios")))]

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_sql::DbInstances;
use uuid::Uuid;

use crate::db;
use crate::error::{codes, StableError};
use crate::spawn::resolve::get_mise_tool_args;

#[derive(Clone, Default)]
pub struct EmbeddedTerminals(pub Arc<Mutex<HashMap<String, EmbeddedSession>>>);

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
struct SessionEndedEmit {
    session_id: String,
    project_id: String,
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
        if argv.get(0).map(|s| s.as_str()) == Some("mise") {
            argv.to_vec()
        } else {
            get_mise_tool_args(runtime_hint, stack, argv)
        }
    } else {
        argv.to_vec()
    };

    // For Windows shell execution, we join arguments into a single string.
    // We use double quotes for arguments with spaces.
    let joined_cmd = args.iter()
        .map(|a| if a.contains(' ') || a.contains('"') { 
            format!("\"{}\"", a.replace("\"", "\"\"")) 
        } else { 
            a.clone() 
        })
        .collect::<Vec<_>>()
        .join(" ");

    // Determine the shell to use. Default to cmd.exe.
    let shell = if let Some(s) = shell_pref {
        if Path::new(s).exists() {
            s.to_string()
        } else {
            // If the preferred shell doesn't exist, fallback to cmd.exe
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
    } else if s_low.contains("cmd.exe") {
        cb.arg("/D");
        cb.arg("/S");
        cb.arg("/C");
        cb.arg(&joined_cmd);
    } else {
        // Fallback for other shells (like git bash or nu)
        cb.arg("-c");
        cb.arg(&joined_cmd);
    }

    cb.cwd(cwd);
    Ok(cb)
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

fn task_command(
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
    std::thread::spawn(move || {
        // Give frontend time to mount and start listening
        std::thread::sleep(std::time::Duration::from_millis(1000));
        
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    break;
                },
                Ok(n) => {
                    let chunk = STANDARD.encode(&buf[..n]);
                    let _ = app_read.emit(
                        "embedded-terminal-data",
                        TermPayload {
                            session_id: sid_read.clone(),
                            chunk,
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
    std::thread::spawn(move || {
        let _wait_res = child.wait();
        if let Ok(mut g) = map.lock() {
            g.remove(&sid_wait);
        }
        let _ = app_wait.emit(
            "embedded-terminal-exit",
            TermExitPayload {
                session_id: sid_wait.clone(),
            },
        );
        tauri::async_runtime::block_on(async move {
            let db = app_wait.state::<DbInstances>();
            if let Ok(pool) = db::sqlite_pool(&*db).await {
                if let Ok(s) = db::end_session(&pool, &sid_wait).await {
                    let _ = app_wait.emit(
                        "session:ended",
                        SessionEndedEmit {
                            session_id: s.id,
                            project_id: s.project_id,
                        },
                    );
                }
            }
        });
    });

    Ok(())
}

fn shell_command(shell_pref: Option<&str>, cwd: &Path) -> Result<CommandBuilder, StableError> {
    if let Some(p) = shell_pref {
        let p = p.trim();
        if !p.is_empty() {
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
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = STANDARD.encode(&buf[..n]);
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
        g.get(session_id)
            .cloned()
            .ok_or_else(|| StableError::new(codes::NOT_FOUND, "terminal session not found"))?
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
        g.get(session_id)
            .cloned()
            .ok_or_else(|| StableError::new(codes::NOT_FOUND, "terminal session not found"))?
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
            .ok_or_else(|| StableError::new(codes::NOT_FOUND, "terminal session not found"))?
    };
    let mut k = sess
        .killer
        .lock()
        .map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?;
    let _ = k.kill();
    Ok(())
}
