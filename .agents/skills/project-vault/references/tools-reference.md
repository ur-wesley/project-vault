# Project Vault MCP Tools Reference

Complete reference for all 36 tools exposed by the Project Vault MCP server (`http://127.0.0.1:1622/sse` or `/mcp`).

---

## 1. Core Project & Environment Tools (9)

### `list_projects`
List all software projects registered in Project Vault with stack, runtime hint, favorite status, tags, and total playtime.
- **Parameters**:
  - `filter` (string, optional): Search term filtering name, stack, or path.
  - `favorite_only` (boolean, optional): Return only favorite projects.
  - `tag` (string, optional): Filter by tag.

### `get_project`
Get detailed project metadata by ID or name (including runnable tasks, tags, paths, and timestamps).
- **Parameters**:
  - `id_or_name` (string, required): Project ID or project name.

### `search_projects`
Search projects in the vault matching name, path, tag, or technology stack.
- **Parameters**:
  - `query` (string, required): Search query string.

### `list_locations`
List all library root directories configured in Project Vault.
- **Parameters**: None `{}`.

### `get_git_status`
Get git repository status (branch, ahead/behind count, clean/dirty status, and version tag).
- **Parameters**:
  - `project_id_or_path` (string, required): Project ID or absolute directory path.

### `list_project_tasks`
List runnable tasks, scripts, and commands defined for a specific project.
- **Parameters**:
  - `id_or_name` (string, required): Project ID or name.

### `list_issues`
List local issues tracked in Project Vault for a specific project.
- **Parameters**:
  - `project_id` (string, required): Project ID.
  - `state` (string, optional): `"open"` or `"closed"`.

### `create_issue`
Create a new local issue in Project Vault.
- **Parameters**:
  - `project_id` (string, required): Project ID.
  - `title` (string, required): Issue title.
  - `body` (string, optional): Markdown issue body.
  - `tags` (array of strings, optional): Categorical tags.

### `close_issue`
Close an issue tracked in Project Vault (local issue or beads issue) for a specific project.
- **Parameters**:
  - `project_id` (string, required): Project ID, name, or absolute path.
  - `issue_number` (integer or string, required): Issue number (e.g. `1`) or bead issue ID (e.g. `"bd-42"`).
  - `reason` (string, optional): Optional closing reason or comment.

---

## 2. Markdown Kanban Board Tools (13)

Markdown-backed boards stored in `<project_root>/.vault/kanban/`.

### `list_boards`
List all kanban boards configured for a project.
- **Parameters**:
  - `project` (string, required): Project ID, name, or absolute path.

### `get_board`
Get a board view with column ordering and all embedded cards.
- **Parameters**:
  - `project` (string, required): Project identifier.
  - `board_id` (string, required): Board slug or ID.

### `list_cards`
List cards on a kanban board with filtering, sorting, and pagination.
- **Parameters**:
  - `project` (string, required): Project identifier.
  - `board_id` (string, required): Board ID.
  - `status` (string, optional): `"backlog"` | `"todo"` | `"doing"` | `"review"` | `"done"` | `"cancelled"`.
  - `priority` (string, optional): `"urgent"` | `"high"` | `"medium"` | `"low"`.
  - `tag` (string, optional): Filter by tag.
  - `assignee` (string, optional): Filter by assignee.
  - `search` (string, optional): Substring match in title or body.
  - `parent` (string, optional): Filter sub-issues under this parent card ID.
  - `include_archived` (boolean, optional, default: false).
  - `sort` (string, optional): `"manual"` | `"priority"` | `"due"` | `"title"`.
  - `limit` (integer, optional): Maximum cards to return.
  - `offset` (integer, optional): Pagination offset.

### `get_card`
Read single card metadata (frontmatter) and markdown body.
- **Parameters**:
  - `project` (string, required)
  - `board_id` (string, required)
  - `card_id` (string, required)

### `create_card`
Create a card file on disk and insert into board column order.
- **Parameters**:
  - `project` (string, required)
  - `board_id` (string, required)
  - `title` (string, required)
  - `body` (string, optional): Markdown description.
  - `status` (string, optional, default: `"backlog"`): `"backlog"` | `"todo"` | `"doing"` | `"review"` | `"done"` | `"cancelled"`.
  - `priority` (string, optional): `"urgent"` | `"high"` | `"medium"` | `"low"`.
  - `tags` (array of strings, optional)
  - `assignees` (array of strings, optional)
  - `parent` (string, optional): Parent card ID.
  - `relations` (array of `{ to: string, kind: "blocking"|"related"|"duplicate" }`, optional)
  - `due` (string, optional): Format `YYYY-MM-DD`.

### `update_card`
Patch card metadata, body, relations, or links.
- **Parameters**:
  - `project` (string, required), `board_id` (string, required), `card_id` (string, required)
  - `title`, `body`, `status`, `priority` (string, optional)
  - `tags`, `assignees` (array of strings, optional)
  - `parent` (string or null, optional): Pass null to clear parent.
  - `relations` (array, optional)
  - `due` (string or null, optional): Pass null to clear due date.
  - `archived` (boolean, optional)
  - `links` (object, optional): `{ tasks: string[], files: string[], issues: string[] }`.

### `move_card`
Move card across columns and reorder position.
- **Parameters**:
  - `project` (string, required), `board_id` (string, required), `card_id` (string, required)
  - `to` (string, required): Target column (`"backlog"` | `"todo"` | `"doing"` | `"review"` | `"done"` | `"cancelled"`).
  - `position` (integer, optional): 0-indexed column position.

### `delete_card`
Delete card file and remove from column order (orphans children, strips relations).
- **Parameters**:
  - `project` (string, required), `board_id` (string, required), `card_id` (string, required)

### `delete_board`
Delete an entire kanban board and all associated cards.
- **Parameters**:
  - `project` (string, required), `board_id` (string, required)

### `list_tags`
List tags on a board with colors and card counts.
- **Parameters**:
  - `project` (string, required), `board_id` (string, required)

### `set_tag_color`
Configure color for a board-scoped tag.
- **Parameters**:
  - `project` (string, required), `board_id` (string, required)
  - `name` (string, required): Tag name.
  - `color` (string, required): Hex color code `#rrggbb`.

### `create_relation`
Add relation between two cards (`blocking`, `related`, or `duplicate`).
- **Parameters**:
  - `project`, `board_id`, `card_id`, `to` (strings, required)
  - `kind` (string, required): `"blocking"` | `"related"` | `"duplicate"`.

### `delete_relation`
Remove relation between two cards.
- **Parameters**:
  - `project`, `board_id`, `card_id`, `to` (strings, required)
  - `kind` (string, required)

---

## 3. Workspaces & Coding Agent Sessions (14)

Isolated git worktrees where external coding agents (`opencode`, `cursor-agent`) execute tasks.

### `list_workspaces`
List agent workspaces.
- **Parameters**:
  - `project` (string, optional)
  - `include_archived` (boolean, optional)
  - `board_id` (string, optional)
  - `card_id` (string, optional)

### `get_workspace`
Inspect workspace details, active sessions, and uncommitted git changes.
- **Parameters**:
  - `workspace_id` (string, required)

### `start_workspace`
Create an isolated git worktree branch and launch initial coding agent session. Automatically links to card if `board_id` and `card_id` are provided.
- **Parameters**:
  - `project` (string, required): Project identifier.
  - `name` (string, required): Workspace name (used for git branch).
  - `executor` (string, optional): `"opencode"` | `"cursor-agent"`.
  - `repo_path` (string, optional): Defaults to project root.
  - `base_branch` (string, optional): Base git branch.
  - `prompt` (string, optional): Prompt text. Defaults to card title + body if linked.
  - `board_id` (string, optional): Associated board ID.
  - `card_id` (string, optional): Associated card ID.

### `create_session`
Start an additional coding agent session within an existing workspace.
- **Parameters**:
  - `workspace_id` (string, required)
  - `executor` (string, optional): Defaults to previous executor or available probe.
  - `prompt` (string, optional): Session prompt.

### `list_sessions`
List agent sessions in a workspace (PTY statuses synchronized live).
- **Parameters**:
  - `workspace_id` (string, required)

### `session_prompt`
Send follow-up instructions to a running agent session.
- **Parameters**:
  - `session_id` (string, required)
  - `prompt` (string, required)

### `get_execution`
Inspect live execution status, exit code, and terminal buffer output tail (last 8000 characters).
- **Parameters**:
  - `session_id` (string, required)

### `delete_workspace`
Stop sessions, tear down git worktree directory, and optionally remove branch.
- **Parameters**:
  - `workspace_id` (string, required)
  - `delete_branch` (boolean, optional, default: false)

### `link_workspace`
Link or unlink a workspace to/from a kanban card.
- **Parameters**:
  - `workspace_id` (string, required)
  - `board_id` (string or null, optional)
  - `card_id` (string or null, optional)

### `workspace_push`
Push workspace branch to git origin with upstream tracking (`git push -u`).
- **Parameters**:
  - `workspace_id` (string, required)

### `workspace_git_info`
Get branch, default base, GitHub repository name/owner, and push status.
- **Parameters**:
  - `workspace_id` (string, required)

### `create_pr`
Push workspace branch and create GitHub Pull Request. Title and body default to linked card and diff stats.
- **Parameters**:
  - `workspace_id` (string, required)
  - `base` (string, optional)
  - `title` (string, optional)
  - `body` (string, optional)

### `pr_status`
Check state of GitHub PR (open, closed, merged, mergeable).
- **Parameters**:
  - `owner` (string, required)
  - `repo` (string, required)
  - `number` (integer, required)

### `merge_pr`
Merge GitHub PR. **Automation trigger**: Automatically marks linked kanban cards as `"done"` and archives workspace.
- **Parameters**:
  - `workspace_id` (string, required)
  - `owner` (string, required)
  - `repo` (string, required)
  - `number` (integer, required)
  - `method` (string, optional, default: `"merge"`): `"merge"` | `"squash"` | `"rebase"`.
