CREATE TABLE IF NOT EXISTS canvas_blueprints (
    id            TEXT PRIMARY KEY NOT NULL,
    name          TEXT NOT NULL,
    description   TEXT,
    app_scope     TEXT NOT NULL,
    layout_json   TEXT NOT NULL,
    is_builtin    INTEGER NOT NULL DEFAULT 0,
    created_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS canvas_project_layouts (
    project_id    TEXT PRIMARY KEY NOT NULL,
    blueprint_id  TEXT,
    layout_mode   TEXT NOT NULL DEFAULT 'freeform',
    viewport_json TEXT NOT NULL DEFAULT '{"panX":0,"panY":0,"zoom":1}',
    nodes_json    TEXT NOT NULL DEFAULT '[]',
    wires_json    TEXT NOT NULL DEFAULT '[]',
    updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_canvas_blueprints_scope
    ON canvas_blueprints (app_scope);
