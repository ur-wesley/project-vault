ALTER TABLE canvas_project_layouts ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 2;
CREATE INDEX IF NOT EXISTS idx_canvas_layouts_updated ON canvas_project_layouts (updated_at_ms);
