PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY NOT NULL,
    path TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    sort_index INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    is_default INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_locations_sort ON locations (sort_index, name);

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY NOT NULL,
    location_id TEXT NOT NULL,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    stack TEXT NOT NULL DEFAULT '',
    runtime_hint TEXT,
    favorite INTEGER NOT NULL DEFAULT 0,
    last_opened_at_ms INTEGER,
    total_playtime_ms INTEGER NOT NULL DEFAULT 0,
    tasks_json TEXT NOT NULL DEFAULT '[]',
    tags_json TEXT NOT NULL DEFAULT '[]',
    FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE CASCADE,
    UNIQUE (location_id, path)
);

CREATE INDEX IF NOT EXISTS idx_projects_location ON projects (location_id);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    started_at_ms INTEGER NOT NULL,
    ended_at_ms INTEGER,
    command TEXT,
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions (project_id);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);
