CREATE TABLE IF NOT EXISTS clipboard_history (
    id            TEXT PRIMARY KEY NOT NULL,
    kind          TEXT NOT NULL,
    preview       TEXT NOT NULL,
    content_text  TEXT,
    content_hash  TEXT NOT NULL,
    payload_path  TEXT,
    meta_json     TEXT NOT NULL DEFAULT '{}',
    source_app    TEXT,
    pinned        INTEGER NOT NULL DEFAULT 0,
    created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clipboard_history_created
    ON clipboard_history (pinned DESC, created_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_clipboard_history_hash
    ON clipboard_history (content_hash);
