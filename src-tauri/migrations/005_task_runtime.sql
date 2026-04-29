ALTER TABLE sessions ADD COLUMN state TEXT NOT NULL DEFAULT 'starting';
ALTER TABLE sessions ADD COLUMN root_pid INTEGER;
ALTER TABLE sessions ADD COLUMN tree_pids_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE sessions ADD COLUMN exit_code INTEGER;
ALTER TABLE sessions ADD COLUMN stop_reason TEXT;
ALTER TABLE sessions ADD COLUMN last_event_at_ms INTEGER NOT NULL DEFAULT 0;

UPDATE sessions
SET state = CASE
    WHEN ended_at_ms IS NULL THEN 'starting'
    ELSE 'success'
END,
last_event_at_ms = CASE
    WHEN last_event_at_ms = 0 THEN started_at_ms
    ELSE last_event_at_ms
END;