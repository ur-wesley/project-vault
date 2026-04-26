# PRD: Task Runner & State Management

## Introduction/Overview
The Task Runner is the core engine for executing commands and long-running processes. It tracks the status of tasks, captures logs in real-time, and persists this information in a local database while the task is active.

## Goals
1. Execute shell commands and `mise` tasks reliably.
2. Provide real-time feedback (logs, status) to the user.
3. Maintain task state across application interactions as long as the task is running.

## User Stories
1. As a developer, I want to start a long-running task (like a dev server) and see its status (Pending, Running, Success, Failed).
2. As a developer, I want to view live streaming logs from my running tasks.
3. As a developer, I want to stop a running task at any time.
4. As a developer, I want to see the history and logs of a task in the database while it is still active or recently finished in the current session.

## Functional Requirements
1. **Execution Engine:**
   - The system must spawn child processes for task execution using `mise run <task>`.
   - The system must handle both short-lived and long-running processes.
2. **State Tracking:**
   - The system must track task states: `idle`, `starting`, `running`, `success`, `error`, `cancelled`.
   - The system must store the current task state and metadata in the local SQLite database.
3. **Log Streaming:**
   - The system must capture `stdout` and `stderr` and stream them to the UI in real-time.
   - The system must store logs in the database for the duration of the task's activity.
4. **Process Control:**
   - The system must allow users to send termination signals (SIGINT/SIGTERM) to running tasks.
5. **Persistence (Active Only):**
   - The system must keep task history and logs in the database as long as the task is running.
   - Data can be purged or moved to a session-only cache once the task is finished/dismissed.

## Non-Goals
- Persistent long-term storage of logs for tasks that finished days ago (out of scope for now).
- Intelligent log analysis or error highlighting.

## Technical Considerations
- Backend implementation in `src-tauri/src/commands/task_runner.rs` and `src-tauri/src/spawn/runner.rs`.
- Use of Tauri's events to stream logs to the frontend.
- Database schema in `src-tauri/migrations/` for task states and logs.

## Success Metrics
- Zero UI lag during high-volume log streaming.
- Task status is accurately reflected in the UI within 100ms of a state change.

## Open Questions
- When exactly should "finished" task data be purged from the database?
- Should we support re-attaching to processes if the app is restarted while they are running?
