//! Shared PTY output sink: base64-encode a chunk, append it to the
//! terminal buffer, and emit `embedded-terminal-data` (+ optionally
//! `task-log-chunk`). Single home for the encode/append/emit pattern
//! previously copy-pasted across the embedded/concurrent reader loops.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri::{AppHandle, Emitter};

use super::embedded::TerminalBuffers;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TermPayload {
    pub session_id: String,
    pub chunk: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TermExitPayload {
    pub session_id: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskLogChunkPayload {
    pub session_id: String,
    pub chunk: String,
}

/// Encode raw PTY bytes and fan out to buffer + frontend events.
pub(crate) fn emit_chunk(
    app: &AppHandle,
    buffers: &TerminalBuffers,
    session_id: &str,
    raw: &[u8],
    task_log: bool,
) {
    emit_encoded_chunk(app, buffers, session_id, &STANDARD.encode(raw), task_log);
}

/// Fan out an already-encoded chunk (e.g. line-framed concurrent output).
pub(crate) fn emit_encoded_chunk(
    app: &AppHandle,
    buffers: &TerminalBuffers,
    session_id: &str,
    chunk: &str,
    task_log: bool,
) {
    buffers.append(session_id, chunk);
    let _ = app.emit(
        "embedded-terminal-data",
        TermPayload {
            session_id: session_id.to_string(),
            chunk: chunk.to_string(),
        },
    );
    if task_log {
        let _ = app.emit(
            "task-log-chunk",
            TaskLogChunkPayload {
                session_id: session_id.to_string(),
                chunk: chunk.to_string(),
            },
        );
    }
}
