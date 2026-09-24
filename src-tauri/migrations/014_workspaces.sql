CREATE TABLE IF NOT EXISTS agent_workspaces (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    card_board TEXT,
    card_id TEXT,
    name TEXT NOT NULL,
    repo_path TEXT NOT NULL,
    worktree_path TEXT NOT NULL,
    branch TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    archived INTEGER NOT NULL DEFAULT 0,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_workspaces_project ON agent_workspaces (project_id);
CREATE INDEX IF NOT EXISTS idx_agent_workspaces_card ON agent_workspaces (card_board, card_id);

CREATE TABLE IF NOT EXISTS agent_sessions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES agent_workspaces (id) ON DELETE CASCADE,
    executor TEXT NOT NULL,
    pty_session_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    last_prompt TEXT,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_workspace ON agent_sessions (workspace_id);
