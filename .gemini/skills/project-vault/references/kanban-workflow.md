# Kanban Workflow & Markdown Storage Guide

## File Structure
Project Vault boards and cards are stored in git-versionable markdown files directly inside the project root:

```
<project-root>/
└── .vault/
    └── kanban/
        └── <board-id>/
            ├── board.json          # Board columns, ordering, metadata
            ├── card-alpha.md       # Card with YAML frontmatter + body
            └── card-beta.md
```

## Lifecycle States (Columns)
Cards follow standard progression:
1. `backlog` — Ideas and unprioritized backlog items.
2. `todo` — Planned for implementation.
3. `doing` — Currently in progress (e.g., active agent session or developer working).
4. `review` — Work completed, undergoing review or PR check.
5. `done` — Completed and merged.
6. `cancelled` — Abandoned or obsolete.

## Moving Cards
Use `move_card`:
```json
{
  "project": "my-project",
  "board_id": "default",
  "card_id": "feature-auth",
  "to": "doing"
}
```

## Creating & Updating Cards
- Creating: `create_card` slugifies the title into `card_id` and adds the card to the board.
- Patching: `update_card` allows updating any subset of properties (`title`, `body`, `status`, `priority`, `tags`, `assignees`, `due`, `links`).
- Card Links: Cards can link to:
  - `tasks`: Runnable scripts from `package.json` / `mise.toml` / `tauri.conf.json`.
  - `files`: Related codebase files.
  - `issues`: Local vault issues.
  - `workspaces`: Associated agent worktree workspaces.
