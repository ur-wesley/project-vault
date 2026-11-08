# Spec: Remove Workspaces Tab and Logic

## Problem Statement
The Workspaces feature (agent git worktrees, sessions, and PR review workflow) is being removed from Project Vault. This includes the UI tab in project detail, card-level workspace creation in Kanban, frontend services and DTOs, i18n keys, and the corresponding backend Rust modules, Tauri IPC commands, and MCP tools.

## Proposed Changes

### 1. Frontend UI & Kanban
- Remove `"workspaces"` from `FULL_WIDTH_TABS` and the `<TabsTrigger>` and `<TabsContent>` in `src/features/project-detail/components/ProjectMainTabs.tsx`. Adjust history tab shortcut index.
- Delete `src/features/kanban/WorkspacePanel.tsx`.
- Delete `src/features/kanban/ReviewPanel.tsx`.
- Delete `src/features/kanban/PrDialog.tsx`.
- Delete `src/features/kanban/diffParse.ts` and `src/features/kanban/diffParse.test.ts`.
- Delete `src/features/kanban/CardWorkspaces.tsx`.
- Remove `CardWorkspaces` import and usage from `src/features/kanban/KanbanCardDialog.tsx`.
- Remove `workspaces` from `KanbanCardMeta.links` in `src/features/kanban/types.ts` and update `src/features/kanban/KanbanBoard.test.tsx`.

### 2. Frontend Services, DTOs & i18n
- Delete `src/services/tauri/workspaces.ts` and remove its re-export from `src/services/tauri/index.ts`.
- Delete `src/types/dto/workspaces.ts` and remove its re-export from `src/types/dto.ts`.
- Remove `workspace` block, `tabWorkspaces`, and `kanban.workspaces*` from `src/messages/en.ts` and `src/messages/de.ts`.

### 3. Backend Rust (Tauri & Core)
- Delete directory `src-tauri/src/workspaces/` (`mod.rs`, `executors.rs`, `pr.rs`, `service.rs`, `worktree.rs`).
- Delete `src-tauri/src/commands/workspaces.rs` and remove module declaration in `src-tauri/src/commands/mod.rs`.
- Delete `src-tauri/src/db/workspaces.rs` and remove module declaration in `src-tauri/src/db/mod.rs`.
- Delete `src-tauri/src/models/workspaces.rs` and remove module declaration in `src-tauri/src/models/mod.rs`.
- Delete `src-tauri/src/mcp/workspace_tools.rs` and unregister tools from `src-tauri/src/mcp/mod.rs` and `src-tauri/src/mcp/tool.rs`.
- Add `pub async fn resolve_project` to `src-tauri/src/db/projects.rs` and update `src-tauri/src/mcp/issue_tools.rs` to use `crate::db::resolve_project`.
- Remove unused `origin_owner_repo` from `src-tauri/src/commands/github_remote.rs`.
- Remove `pub workspaces: Vec<String>` from `CardLinks` in `src-tauri/src/kanban/model.rs`.
- Remove `pub mod workspaces;` and 19 workspace command registrations from `src-tauri/src/lib.rs`.
- Leave migration `014_workspaces.sql` in place to preserve database checksum integrity.

### 4. Documentation & Agent Skills
- Update `docs/kanban.md`.
- Update `.agents/skills/project-vault/SKILL.md` and related references.
