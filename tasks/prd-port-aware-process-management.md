# PRD: Port-aware process management

## 1. Introduction / overview

Project Vault already starts project tasks and tracks their runtime state. This feature adds a lightweight, port-aware control layer for any app-started server or long-running process so the app can tell which project owns a port, detect port collisions before launch, and help the user stop or reclaim the process without leaving Project Vault.

The goal is not to build a general-purpose system process manager. The goal is to make local dev ports first-class inside the app: visible, attributable, recoverable, and safe to act on.

## 2. Goals

1. Show which ports are currently owned by processes started from the app.
2. Detect when a requested port is already occupied before or during launch.
3. Let the user stop app-owned listeners from the UI with a clear confirmation path.
4. Let the user inspect and manage external processes occupying a port, with clear ownership details and destructive-action warnings.
5. Keep port state in sync with task and process lifecycle so stale port records are reconciled automatically.

## 3. User stories

1. As a developer, I want to see that my project server is already running on a port so I do not start duplicate servers.
2. As a developer, I want to know why a launch failed when a port is occupied so I can fix it quickly.
3. As a developer, I want to stop a server started by Project Vault from the project UI so I do not have to hunt for the terminal or PID.
4. As a developer, I want to see which process is using a port even if it was not started by the app so I can decide whether to close it.
5. As a developer, I want port status to update after a restart or app crash so I do not act on stale information.

## 4. Functional requirements

1. **Track app-owned ports**
   - The system must record every listening port created by a process started through Project Vault task or launch flows.
   - Each record must include at minimum: project id, project path, launch id or session id, command label, port number, process id, process tree details when available, and the current state.

2. **Detect port conflicts**
   - Before starting a task that expects a port, the system must check whether the port is already in use on the local machine.
   - If the port is occupied, the UI must show a conflict state instead of failing silently.
   - If the port belongs to a process the app already started, the UI must treat this as an active running server rather than a new launch conflict.

3. **Show port ownership and metadata**
   - The UI must display whether the port is owned by Project Vault, owned by another local process, or unresolved.
   - When available, the UI must show the owning process name, pid, command line summary, project association, and time started.
   - If ownership cannot be resolved, the UI must show a stable fallback message rather than an error stack.

4. **Manage app-owned processes**
   - For ports owned by app-started processes, the user must be able to stop the full process tree from the UI.
   - The stop action must target the whole tree, not just the root pid.
   - The UI must require confirmation if the action could terminate work or lose server state.

5. **Manage external processes occupying a port**
   - For ports owned by processes not started by Project Vault, the app must present a destructive action path only after clearly identifying the process and its port ownership.
   - Termination of an external process must require an explicit confirmation step before the action is sent.
   - The app must not hide the fact that the process is external to Project Vault.
   - The UI must warn the user before attempting termination of an external process and must surface any refusal or failure from the OS.

6. **Offer recovery choices on conflict**
   - When a launch hits an occupied port, the UI must offer at least one recovery action such as stop owner, retry, or choose a different port.
   - If the project already has a known active listener on that port, the UI must offer a reuse or attach style action instead of encouraging duplicate launch.

7. **Persist and recover state**
   - The system must persist active port records so they can be recovered on app restart.
   - On startup, the system must reconcile stored port records against current OS state and mark missing listeners as stopped, stale, or unresolved.

8. **Emit live updates**
   - The UI must update when a port becomes free, changes owner, is reclaimed by an app-managed process, or is terminated.
   - Port updates must be driven by backend events or targeted invalidation rather than manual refresh only.

9. **Support common desktop platforms**
   - The feature must work on Windows, macOS, and Linux where supported by the app’s existing runtime model.
   - If the platform cannot resolve a process owner or command line cleanly, the UI must fail gracefully.

## 5. Non-goals

- General system-wide process management for arbitrary non-port-related processes.
- Network traffic inspection, packet capture, or proxying.
- Remote port management for containers, SSH tunnels, or cloud hosts.
- Auto-editing project configuration files to rewrite ports in v1.
- A full replacement for terminal-based tooling such as `netstat`, `lsof`, or `taskkill`.

## 6. Design considerations

- Primary placement should be inside **Project Detail**, in a dedicated **Ports** panel or tab next to tasks and terminal controls. Port ownership is tied to a project, so the project view is the most natural home.
- A secondary global surface can show active conflicts or app-owned listeners, but it should stay lightweight and focused on recovery actions.
- App-owned listeners should look like managed project state, not like raw OS process entries.
- Destructive actions must be visually distinct and require confirmation when the target is not clearly owned by the app.
- Good default copy should distinguish between “already running”, “port in use”, “app-owned”, and “external process”.

## 7. Technical considerations

- The backend should remain the source of truth for port ownership and port state transitions.
- Port detection should reuse the existing task/process lifecycle work so wrapper processes, child processes, and process-tree reassociation stay consistent.
- The implementation will likely need a mix of Rust process-tree tracking and platform-specific socket inspection to map listening ports back to pid and process metadata.
- Port records should be persisted in SQLite, either alongside task runs or in a dedicated minimal table, so restart recovery is possible.
- Frontend DTOs should be explicit about ownership, conflict state, actions, and recovery results so the UI can keep the distinction between app-owned and external listeners clear.
- All termination paths should continue to respect the app’s security model and should never become arbitrary shell execution.

## 8. Success metrics

- Users can identify what is using a port without opening a separate terminal or system utility.
- App-started servers can be stopped from inside Project Vault in one obvious action.
- Launch failures caused by occupied ports become understandable and recoverable.
- Port status remains accurate after a restart, crash, or project reopen.
- Users spend less time manually hunting processes with platform-specific tools.

## 9. Open questions

1. Should a conflict offer an automatic free-port suggestion in v1, or just stop/retry/manual selection actions?
2. Should port ranges be supported in the first version, or only single listening ports?
3. Should the app keep a history of past port ownership per project, or only active state?
