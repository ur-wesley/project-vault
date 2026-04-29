# Tasks: Port-aware process management

**PRD:** [`prd-port-aware-process-management.md`](./prd-port-aware-process-management.md)

## Relevant Files

- `src-tauri/src/spawn/task_monitor.rs` - Shared process and port monitoring service for app-owned listeners and reassociation.
- `src-tauri/src/commands/task_runner.rs` - Launch flow integration where port expectations, conflicts, and recovery actions are surfaced.
- `src-tauri/src/spawn/runner.rs` - Process spawning helpers needed for launch, stop, and tree-aware lifecycle handling.
- `src-tauri/src/db/task_runs.rs` - Existing task-run persistence pattern that can be extended or mirrored for port records and recovery state.
- `src-tauri/migrations/*.sql` - SQLite schema changes for active port ownership, conflict snapshots, and recovery history.
- `src-tauri/src/models.rs` - Backend DTOs for port ownership, conflict state, and recovery actions.
- `src-tauri/src/lib.rs` - Command registration and startup reconciliation wiring.
- `src-tauri/src/commands/mod.rs` - Module wiring for new port-related commands.
- `src-tauri/src/db/*` - Repository helpers for new persistence and reconciliation logic.
- `src/types/dto.ts` - Frontend DTO mirror for port state and ownership metadata.
- `src/services/tauri.ts` - Typed invoke wrappers and event subscriptions for port-related commands and updates.
- `src/lib/event-hub-context.tsx` - Typed in-app event channels for port updates and conflict events.
- `src/features/project-detail/model/createProjectDetailModel.ts` - Project-level state orchestration for port status, launch conflicts, and recovery actions.
- `src/features/project-detail/components/ProjectMainTabs.tsx` - Project detail placement for the Ports panel or tab.
- `src/features/project-detail/` - Any new ports panel or supporting components used by the project detail view.
- `src/messages/en.ts`
- `src/messages/de.ts`

### Notes

- Port ownership should stay backend-owned and event-driven so the UI can distinguish app-owned listeners from external processes.
- Reuse the existing task and process lifecycle work where possible instead of introducing a second process-tracking path.
- Keep termination behavior scoped and explicit: app-owned listeners can stop the full tree, external owners require a clear confirmation path.
- Use `bun run test` for frontend coverage and `cargo test` or `cargo check` in `src-tauri` for backend validation.

## Tasks

- [ ] 1.0 Define the port ownership model and persistence
  - [ ] 1.1 Review the existing task-run and session models to decide which port fields can be reused.
  - [ ] 1.2 Define backend DTOs for port ownership, listener state, conflict state, and recovery actions.
  - [ ] 1.3 Add SQLite schema and migration changes for active ports, owner metadata, and recovery history.
  - [ ] 1.4 Implement repository helpers for create, update, query, reconcile, and purge operations on port records.
  - [ ] 1.5 Add tests for schema migration, record persistence, and startup recovery of stored port state.
- [ ] 2.0 Add backend port detection and process tracking
  - [ ] 2.1 Extend or extract the shared task monitor so it can observe listening ports for app-started processes.
  - [ ] 2.2 Track the full process tree, not just the root PID, and rebind when wrapper processes hand off execution.
  - [ ] 2.3 Implement platform-specific port inspection so the backend can resolve current owners for occupied ports.
  - [ ] 2.4 Reconcile stored port records on startup and mark missing, stale, or unresolved listeners.
  - [ ] 2.5 Add unit tests for port detection, process-tree reassociation, and stale-owner classification.
- [ ] 3.0 Implement port conflict and recovery commands
  - [ ] 3.1 Add commands to query active ports by project and to inspect a specific port number.
  - [ ] 3.2 Add launch-time conflict checks that return structured port conflict DTOs.
  - [ ] 3.3 Implement recovery actions for app-owned listeners, including stop tree, reuse, and retry paths.
  - [ ] 3.4 Implement guarded termination for external owners with explicit confirmation input.
  - [ ] 3.5 Emit backend events when port state changes, conflicts resolve, or processes exit.
  - [ ] 3.6 Add command-level tests for occupied-port launches, recovery paths, and stop behavior.
- [ ] 4.0 Build the project detail ports UI
  - [ ] 4.1 Add a dedicated Ports panel or tab to project detail for owned and conflicting ports.
  - [ ] 4.2 Show owner state, process metadata, and fallback messaging for unresolved or external cases.
  - [ ] 4.3 Wire UI actions for stop owner, retry, choose different port, and confirm external termination.
  - [ ] 4.4 Add loading, busy, success, and error states so users can see which action is in flight.
  - [ ] 4.5 Hook the UI into the event bus and query layer so port changes update live.
  - [ ] 4.6 Add component or integration tests for ownership display, conflict handling, and confirmation dialogs.
- [ ] 5.0 Validate behavior, tests, and docs
  - [ ] 5.1 Add integration coverage for port detection, conflict handling, and startup reconciliation.
  - [ ] 5.2 Add Windows-specific validation for process ownership lookup and full-tree termination.
  - [ ] 5.3 Update the PRD or docs with the supported port states, confirmation rules, and recovery actions.
  - [ ] 5.4 Clean up any duplicate task or port-tracking paths once the shared flow is stable.
