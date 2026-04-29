# PRD: Mise Task Integration

## Status: IMPLEMENTED ✅

## Introduction/Overview
This feature integrates `mise` tasks into the application's task system. It allows users to discover existing tasks defined in `.mise.toml` and provides a GUI to create or modify tasks.

## Goals
1. ✅ Automatically expose `mise` tasks as executable actions in the UI.
2. ✅ Provide a visual editor for defining new tasks without manually editing TOML files.
3. ✅ Centralize task management for a project.

## User Stories
1. ✅ As a developer, I want to see all tasks defined in my `mise.toml` in the app's task list.
2. ✅ As a developer, I want to create a new task (e.g., `build:prod`) using a form and have it saved to `mise.toml`.
3. ✅ As a developer, I want to run a `mise` task with a single click.
4. ✅ As a developer, I want to edit an existing `mise` task via the UI.
5. ✅ As a developer, I want to delete a `mise` task via the UI.

## Functional Requirements

### 1. Task Discovery ✅
- ✅ The system scans the project root for `.mise.toml` or `mise.toml`.
- ✅ The system parses the `[tasks]` section natively (using the `toml` crate) instead of shelling out to `mise tasks ls --json`.
- ✅ Discovered tasks include: name, command (`run`), description, dependencies (`depends`), and working directory (`dir`).
- ✅ Tasks are stored in the app's internal `TaskDto` model with `kind: "mise"`.

### 2. Task Creation GUI ✅
- ✅ A dialog form is available from the Tasks tab with a "New Task" button.
- ✅ The form allows entering: task name, command (multi-line textarea), description, and dependencies.
- ✅ The system writes the new task into the project's `.mise.toml` file using `toml_edit` to preserve existing formatting and comments.
- ✅ After saving, the project's task list is refreshed in the UI and database.

### 3. Task Execution ✅
- ✅ Mise tasks are triggered with a single click (play button) in the Tasks tab.
- ✅ Tasks run through the existing PTY-based Task Runner (`spawn_project_task`).
- ✅ `mise run <task>` commands pass through directly without being double-wrapped by `mise exec`.

### 4. Task Editing ✅
- ✅ Each non-active mise task shows an edit (pencil) button.
- ✅ Clicking edit opens the Task Editor dialog pre-filled with the task's current data.
- ✅ Saving updates the `.mise.toml` file via `toml_edit`.
- ✅ The `source` field on `TaskDto` preserves the original command for accurate round-trip editing.

### 5. Task Deletion ✅
- ✅ Each non-active mise task shows a delete (trash) button.
- ✅ Deletion requires confirmation via an AlertDialog.
- ✅ The task is removed from the `.mise.toml` file and the UI refreshes.

## Extension: Justfile Support ✅
> **Note:** This was originally a Non-Goal, but was explicitly requested by the user.

- ✅ The system also discovers `justfile` / `Justfile` recipes as tasks.
- ✅ Justfile recipes are parsed for name, description (from `#` comments), dependencies, and body.
- ✅ The Task Editor supports creating/editing Justfile tasks.
- ✅ New recipes are appended to the `justfile`; deletions remove the recipe and its body.

## Non-Goals (Original)
- ~~Supporting non-`mise` task runners (e.g., raw `Makefile`, `just`) unless they are invoked via `mise`.~~ **DEVIATION:** Justfile support was added per user request.
- ~~Complex task dependency visualization (graph views).~~ Still not implemented.

## Technical Implementation

### Backend (`src-tauri/src/task_config/`)
| File | Purpose |
|------|---------|
| `mise.rs` | Native TOML read/write for `.mise.toml` using `toml` (read) and `toml_edit` (write) |
| `justfile.rs` | Line-based parser and writer for `justfile` recipes |
| `mod.rs` | Unified `ProjectTaskConfig` DTO and dispatch layer |

### New Tauri Commands
| Command | Purpose |
|---------|---------|
| `read_project_task_config` | Returns all tasks + metadata (hasMiseConfig, hasJustfile) |
| `write_project_task` | Writes a task to the appropriate config file and updates DB |
| `delete_project_task` | Removes a task from the config file and updates DB |

### Frontend (`src/features/project-detail/components/`)
| File | Purpose |
|------|---------|
| `TaskEditorDialog.tsx` | Dialog for creating/editing tasks (kind selector, name, command, description, depends) |

### Model Changes
- `TaskDto` extended with:
  - `description?: string`
  - `depends: string[]`
  - `source?: string` — preserves original command for round-trip editing

### Discovery Changes
- `MiseDetector` now uses native TOML parsing (`task_config::mise::read_mise_tasks`) instead of `mise tasks ls --json` shell-out.
- New `JustfileDetector` discovers justfile recipes.

## Open Questions (Resolved)
1. ✅ **How to handle multi-line script tasks in a simple form?** — Uses a `<TextFieldTextArea>` (multi-line textarea) for the command field.
2. ❓ **Should we support `mise` task aliases?** — Not yet implemented. Could be added by parsing the `alias` key in the TOML `[tasks]` table.

## Success Metrics
- ✅ 100% parity between `mise tasks` CLI output and UI display.
- ✅ Users can create, edit, and delete tasks without opening a text editor.
