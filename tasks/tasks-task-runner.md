# Tasks: Task Runner & State Management

**PRD:** [`prd-task-runner.md`](./prd-task-runner.md)

## Relevant Files

- `src-tauri/src/commands/task_runner.rs` - current task entry point; should become a thin orchestrator around shared task state and process monitoring.
- `src-tauri/src/spawn/runner.rs` - cross-platform command and shell spawning helpers.
- `src-tauri/src/spawn/embedded.rs` - existing PTY streaming implementation and Tauri events.
- `src-tauri/src/spawn/task_monitor.rs` - shared `sysinfo`-based task monitor for PID tree tracking, lifecycle events, and stop handling.
- `src-tauri/src/spawn/ide_session.rs` - current `sysinfo`-based process watcher; good reference for tree tracking and recovery.
- `src-tauri/src/discovery/detectors.rs` - manifest discovery for `package.json`, `mise`, Go, Rust, Python, .NET, Deno, Composer, Gemfile, Mix, Gradle, Maven, Swift, and CMake.
- `src-tauri/src/discovery/registry.rs` - detector ordering and merge rules.
- `src-tauri/src/db/sessions.rs` - active session persistence, runtime state, process-tree snapshots, and recovery.
- `src-tauri/src/models.rs` - backend DTOs for sessions and task-related data.
- `src-tauri/src/lib.rs` - command registration and startup recovery.
- `src-tauri/src/commands/mod.rs` - command module wiring.
- `src-tauri/migrations/005_task_runtime.sql` - session runtime-state columns for active task tracking.
- `src-tauri/migrations/*.sql` - schema changes for task runtime state, transitions, logs, and retention.
- `src/types/dto.ts` - frontend DTO mirror for task state, process-tree, and log payloads.
- `src/services/tauri.ts` - invoke wrappers and event subscriptions for task execution.
- `src/lib/event-hub-context.tsx` - typed in-app event bus channels.
- `src/features/project-detail/model/createProjectDetailModel.ts` - task launch/stop flow and active session updates.
- `src/features/project-detail/components/ProjectMainTabs.tsx` - task list UI and active-session badge.
- `src/features/project-detail/EmbeddedTerminal.tsx` - live terminal UI that can be reused for task output.
- `src/components/task-stream-dialog.tsx` - existing task output dialog; likely redundant with the embedded terminal surface.
- `src/messages/en.ts`
- `src/messages/de.ts`
- `src-tauri/src/commands/sessions.rs` - active session query commands that may be replaced or supplemented by task-run state queries.

### Notes

- The detector layer already covers many manifest types. The missing work is mostly around realtime execution, not basic discovery.
- `spawn_project_task` currently mixes validation, session creation, PTY fallback, and termination handling. That should be split so one shared runner owns process lifecycle.
- `ide_session.rs` already uses `sysinfo`, but it is ad hoc polling. Reuse the idea in a single monitor service so task and IDE tracking do not diverge.
- Frontend polling for `active-sessions` should become event-driven where possible.
- `task-stream-dialog.tsx` appears unused in the current flow, so consolidate or remove duplicate task-output UI instead of maintaining two surfaces.
- Use `bun run test` for frontend coverage and `cargo test` / `cargo check` in `src-tauri` for backend monitor and persistence changes.

## Instructions for Completing Tasks

As you complete each task, change `- [ ]` to `- [x]` in this file. Update the file after each sub-task, not just after a parent task.

## Tasks

- [ ] 1.0 Audit and extend task-source discovery
  - [ ] 1.1 Review the existing detectors and document which task sources are already supported versus missing.
  - [ ] 1.2 Add or refine detectors for any still-missing manifest types the PRD expects, especially `Makefile` and `justfile`.
  - [ ] 1.3 Normalize discovered task metadata so all sources produce a stable `TaskDto` shape with consistent `id`, `label`, `argv`, `kind`, and runtime hints.
  - [ ] 1.4 Keep detector merging deterministic for monorepos and mixed-manifest projects.
  - [ ] 1.5 Add fixture-based tests for at least one `package.json` project, one `mise` project, and one non-JS manifest.
- [ ] 2.0 Add a shared realtime task monitor and event contract
  - [x] 2.1 Extract a reusable backend monitor instead of keeping separate PID polling logic in task, embedded terminal, and IDE code paths.
  - [ ] 2.2 Use `sysinfo` to track the full spawned tree, not just the root PID, and rebind when wrapper processes hand off execution.
  - [x] 2.3 Define explicit task events for `started`, `state-changed`, `tree-changed`, `log-chunk`, `exited`, `killed`, `recovered`, and `error`.
  - [x] 2.4 Track task state transitions and timestamps in one place so the UI can read `starting`, `running`, `success`, `error`, and `cancelled` consistently.
  - [ ] 2.5 Add unit tests for PID reassociation, process-tree updates, and exit-state classification.
- [ ] 3.0 Persist task runs and logs in SQLite
  - [x] 3.1 Add runtime-state columns for active runs, tree snapshots, exit codes, and stop reasons.
  - [x] 3.2 Implement DB helpers for create, update, query, and purge operations on task runs and logs.
  - [x] 3.3 Decide whether task data lives beside `sessions` or in a dedicated table, then keep the schema minimal and explicit.
  - [x] 3.4 Implement the retention rule for finished or dismissed runs so active data is purged safely.
  - [ ] 3.5 Add migration and repository tests for active-run recovery and log persistence.
- [ ] 4.0 Refactor task execution around the shared runner
  - [x] 4.1 Simplify `spawn_project_task` so it validates input, resolves runtime context, creates the run, and hands process lifecycle off to the shared monitor.
  - [x] 4.2 Keep the PTY path and fallback console path aligned so both emit the same task events and state transitions.
  - [x] 4.3 Add stop and kill support that targets the whole task tree, not only the root PID.
  - [x] 4.4 Emit backend events immediately on start, output, tree changes, completion, and failure instead of waiting for UI polling.
  - [ ] 4.5 Reuse command normalization and shell setup helpers where possible so `open_project_shell` and task spawning do not duplicate setup logic.
  - [ ] 4.6 Add command-level tests for successful launch, failed launch, cancellation, and orphan recovery.
- [ ] 5.0 Update the frontend for realtime task state
  - [ ] 5.1 Add typed task event listeners to the Solid event hub and Tauri service layer.
  - [x] 5.2 Replace the 3-second active-session polling with event-driven updates or targeted cache invalidation.
  - [x] 5.3 Surface live state and process-tree status in the project detail task tab and badge counts.
  - [ ] 5.4 Consolidate the current embedded-terminal task UI with the task-stream dialog so there is one consistent output surface.
  - [ ] 5.5 Add UI states for starting, streaming, success, error, cancelled, and killed runs.
  - [ ] 5.6 Add component or integration tests for live state updates and stop actions.
- [ ] 6.0 Validate, document, and simplify the finished flow
  - [ ] 6.1 Add integration coverage for manifest discovery, task launch, sysinfo tree tracking, and log streaming.
  - [ ] 6.2 Add Windows-specific validation for `wt.exe`, console fallback, and process-tree reassociation.
  - [ ] 6.3 Document supported task sources, event names, stop behavior, and retention rules in the PRD or docs.
  - [ ] 6.4 Remove or merge any duplicate UI or monitoring code once the shared path is stable.
  - [ ] 6.5 Update release notes or the feature spec if the final behavior changes the current task/session model.
