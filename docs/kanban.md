# Kanban — Markdown File Format

File-backed kanban for Project Vault. Simple, AI-readable, git-friendly, fully
accessible via Tauri commands and MCP tools. No database tables for boards/cards.

## Layout

Boards live **inside the project repo** so they are versioned, diffable and
editable by any AI file tool:

```
<project>/.vault/kanban/
  boards/<board-id>/board.md
  boards/<board-id>/cards/<card-id>.md
```

- `<board-id>`, `<card-id>`: `kebab-case`, `[a-z0-9-]`, max 64 chars.
- Multiple boards per project are supported (e.g. `roadmap`, `sprint-12`).
- Missing `.vault/kanban/` = zero boards (not an error).

## board.md

`board.md` is the **index**. Its frontmatter is source of truth for columns and
card order. The body is a human-readable rendering (regenerated on every write).

```md
---
id: sprint-12
title: Sprint 12
columns: [backlog, todo, doing, review, done, cancelled]
order:
  backlog: [empty-state]
  todo: [auth-card]
  doing: [drag-drop]
  review: []
  done: []
  cancelled: []
tag_colors:
  ui: "#38bdf8"
---

# Sprint 12

## Doing

- [ ] #drag-drop — Implement drag-drop

## Todo

- [ ] #auth-card — OAuth login
      ...
```

Rules (vibe-kanban column model):

- `columns` defaults to `[backlog, todo, doing, review, done, cancelled]`.
  `backlog`/`cancelled` are hidden in the UI unless "All" is toggled.
- Boards written by v1 (`[backlog, ready, doing, done]`) auto-migrate on read:
  `ready` → `todo`, `p0..p3` → `urgent/high/medium/low`, `has_duplicate` →
  `duplicate`. Migration persists on the next board write.
- Custom columns are accepted by the parser but cards can only be moved into
  the six known statuses via the API (unknown columns fall back to `backlog`).
- `order` maps every column to an array of card ids. Cards listed in `order`
  but missing on disk are **skipped on read** (not fatal). Cards on disk but
  missing from `order` are appended to their `status` column on read
  (self-healing).
- On conflict, **`order` wins** and the card's `status` frontmatter is repaired
  to the column it was found in.
- The body after `---` is informational only and rewritten by the store.

## cards/\<card-id\>.md

One file per card. Frontmatter is the machine API, body is free markdown
(description, acceptance criteria, notes).

```md
---
id: drag-drop
board: sprint-12
title: Implement drag-drop
status: doing
priority: high
tags: [ui, kanban]
assignees: [wesley]
parent: null
relations:
  - { to: auth-card, kind: blocking }
due: 2026-10-05
archived: false
links:
  tasks: ["bun run test"]
  files: ["src/features/kanban/Board.tsx"]
  issues: [github:12]
  workspaces: []
checklist:
  - { label: "column dnd", done: true }
  - { label: "card dialog", done: false }
---

## Notes

Acceptance: move card todo → doing → review → done via drag or MCP `move_card`.
The description becomes the coding-agent prompt once Phase 2 workspaces land.
```

Field reference:

| field       | type                                                      | required | default  |
| ----------- | --------------------------------------------------------- | -------- | -------- |
| `id`        | kebab-case string                                         | yes      | —        |
| `board`     | board id                                                  | yes      | —        |
| `title`     | string, 1–200 chars                                       | yes      | —        |
| `status`    | `backlog`\|`todo`\|`doing`\|`review`\|`done`\|`cancelled` | no       | `todo`   |
| `priority`  | `urgent`\|`high`\|`medium`\|`low`                         | no       | `medium` |
| `tags`      | string[] (colors live in board `tag_colors`)              | no       | `[]`     |
| `assignees` | string[] (free-form usernames)                            | no       | `[]`     |
| `parent`    | card id \| `null` (sub-issue; must exist)                 | no       | `null`   |
| `relations` | `{ to, kind: blocking\|related\|duplicate }[]`            | no       | `[]`     |
| `due`       | `YYYY-MM-DD` or `null`                                    | no       | `null`   |
| `archived`  | boolean (hidden from board, still readable)               | no       | `false`  |
| `links`     | `{ tasks, files, issues, workspaces }` string arrays      | no       | `{}`     |
| `checklist` | `{ label, done }[]`                                       | no       | `[]`     |

- Unknown frontmatter keys are **preserved** on write (forward compatible).
- `due` must match `^\d{4}-\d{2}-\d{2}$` when present.
- `archived: true` cards are excluded from `order` rendering but kept on disk.

## Operations (all order-preserving + atomic)

- `create_board(project, id, title)` → writes `board.md` with empty columns.
- `create_card(project, board, title, ...)` → writes card file + appends id to
  `order[<status>]`, regenerates `board.md` body.
- `move_card(project, board, card, to, position?)` → removes id from old column,
  inserts at `position` (default: end), updates card `status`, regenerates body.
  Single write pair, no intermediate states visible to readers.
- `update_card` → patches frontmatter fields + optionally body; moving status
  via `update_card(status=…)` behaves like `move_card` to end of column.
- All writes reject path traversal: ids are validated against
  `^[a-z0-9-]{1,64}$` and resolved strictly under `<project>/.vault/kanban/`.

## MCP surface

Tools (see Settings → MCP for live list):

- `list_boards { project }`, `delete_board { project, board_id }`
- `get_board { project, board_id }` — board + embedded cards + tag colors
- `list_cards { project, board_id, status?, priority?, tag?, assignee?, search?, parent?, include_archived?, sort?, limit?, offset? }`
- `get_card { project, board_id, card_id }`, `delete_card { project, board_id, card_id }`
- `create_card { project, board_id, title, body?, status?, priority?, tags?, assignees?, parent?, relations?, due? }`
- `update_card { project, board_id, card_id, patch… }` (`parent`/`due`: null clears)
- `move_card { project, board_id, card_id, to, position? }`
- `list_tags { project, board_id }`, `set_tag_color { project, board_id, name, color }`
- `create_relation { project, board_id, card_id, to, kind }`, `delete_relation { … }`

Resources:

- `vault://boards/{projectId}` — JSON board list
- `vault://board/{projectId}/{boardId}` — full board with embedded cards

Projects are resolved by id **or** name **or** absolute path (same as
`list_project_tasks`).

## Minimal AI workflow

1. `list_boards` → pick board (or `create_board`).
2. `get_board` → full state in one call.
3. `create_card` / `move_card` / `update_card` to progress work.
4. Card bodies stay human-editable markdown — prefer checklist updates over
   rewriting the file by hand so `order` never drifts.

## Agent workspaces (Phase 2)

A workspace is an isolated `git worktree` + branch where a coding-agent CLI
(`opencode`, `cursor-agent`, probed via `<bin> --version`) executes card work —
vibe-kanban style. The plan stays markdown; runtime state (workspaces,
sessions, live status) lives in SQLite (`agent_workspaces`, `agent_sessions`).

- Worktrees live at `<repo>/.vault/worktrees/<workspace-id>`, auto-excluded
  from `git status` via `.git/info/exclude`. Branches are `pv/<card>-<shortid>`.
- `start_workspace { project, name, executor?, prompt?, board_id?, card_id? }`
  creates the worktree, links the card (`links.workspaces`), and starts the
  first session. Omitting `prompt` uses the card's title + body as the prompt.
- Sessions run one-shot (`opencode run <prompt>`, `cursor-agent --print
--force <prompt>`) in the shared embedded PTY system, so the Terminal tab
  can attach to any agent run. Exit code 0 → `done`, else `error`.
- Follow-ups go to live sessions via `session_prompt`; finished sessions need
  a new session (vibe-kanban `run_session_prompt` equivalent).
- `get_workspace` returns sessions + uncommitted worktree changes;
  `get_execution` returns live status + output tail.
- `delete_workspace` stops sessions, removes the worktree (optionally the
  branch with `delete_branch: true`), and unlinks the card.

## Review loop → merge (Phase 3)

- `get_workspace` embeds per-file `additions/deletions` (shared backend with
  the project diff views: numstat, untracked-file synthesis, binary guard).
- The Workspaces tab shows unified/side-by-side diffs with a file tree,
  search, and inline comments. Pending comments batch into one message and go
  back to the agent via `session_prompt` (or a fresh session when none is live).
- `workspace_push`, `workspace_git_info` (branch/base/owner/repo/pushed),
  `create_pr` (pushes first; title/body default to the card + change stats),
  `pr_status`, `merge_pr` (`merge|squash|rebase`).
- PRs use the `github_token` setting via GitHub REST — no CLI needed.
- Automation: agent exit 0 moves a `doing` card to `review`; a successful
  merge moves the card to `done` and archives the workspace (worktree kept
  until explicit delete).
- Fixed along the way: `run_git_async` used full `trim()`, which silently
  dropped unstaged (` M`) files from every diff view — now `trim_end()`.
