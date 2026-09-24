# Tasks: Project Context Canvas

**PRD / Architectural Blueprint:** [`project_context_canvas_blueprint.md`](file:///C:/Users/parac/.gemini/antigravity/brain/a84abf69-0868-4064-a19c-f987e7c0f7c8/project_context_canvas_blueprint.md)

## Relevant Files

- `src-tauri/migrations/012_canvas.sql` — SQLite schema for canvas project layouts, node coordinates, viewport state, and blueprints.
- `src-tauri/src/models.rs` — Backend Rust DTOs for canvas nodes, wires, viewport, and recipes.
- `src-tauri/src/db/canvas.rs` — SQLite repository operations for loading and persisting canvas layouts and blueprints.
- `src-tauri/src/commands/canvas.rs` — Tauri IPC commands for layout persistence, blueprint management, and node status queries.
- `src-tauri/src/lib.rs` — Command registration in `generate_handler![]` and initial migration wiring.
- `src-tauri/capabilities/canvas.json` — Tauri v2 permission capability for dynamic `canvas-*` windows.
- `canvas-window.html` — Standalone HTML entrypoint for detached canvas flyout windows.
- `src/canvas-window.tsx` — Standalone root component rendering the flyout canvas with window controls.
- `vite.config.ts` — Vite rollup input configuration registering `canvas-window.html`.
- `src/lib/app-url.ts` — Routing and tab registration adding `"canvas"` to `PROJECT_DETAIL_TABS`.
- `src/types/dto.ts` — TypeScript DTO mirrors for canvas nodes, wires, blueprints, and layout payloads.
- `src/services/tauri/canvas.ts` — Frontend typed service wrappers for canvas IPC commands.
- `src/features/canvas/` — New feature module containing canvas surface, nodes, wires, modes, floating windows, and toolbar.
- `src/features/canvas/flyout/` — Multi-window spawning, monitor detection, and "Follow Active Project" sync.
- `src/features/project-detail/` — Placement of the Canvas tab inside the project detail view.
- `src/messages/en.ts` / `src/messages/de.ts` — Internationalization messages for canvas UI, toolbars, and recipes.

---

## Tasks

- [x] **1.0 Database Schema & Backend DTOs (Rust & SQLite)**
  - [x] 1.1 Create migration `src-tauri/migrations/012_canvas.sql` defining `canvas_blueprints` and `canvas_project_layouts`.
  - [x] 1.2 Register migration 12 in `src-tauri/src/lib.rs` `sql_migrations()`.
  - [x] 1.3 Add canvas DTOs to `src-tauri/src/models.rs`: `CanvasNodeDto`, `CanvasWireDto`, `ViewportDto`, `CanvasBlueprintDto`, and `CanvasProjectLayoutDto`.
  - [x] 1.4 Create `src-tauri/src/db/canvas.rs` with SQLite repository methods: `get_canvas_layout`, `save_canvas_layout`, `list_canvas_blueprints`, `save_canvas_blueprint`, `delete_canvas_blueprint`.
  - [x] 1.5 Export canvas repository in `src-tauri/src/db/mod.rs`.

- [x] **2.0 Backend Commands & Window Capabilities**
  - [x] 2.1 Create `src-tauri/src/commands/canvas.rs` implementing IPC commands:
    - `get_canvas_layout(project_id: String)`
    - `save_canvas_layout(layout: CanvasProjectLayoutDto)`
    - `list_canvas_blueprints()`
    - `save_canvas_blueprint(blueprint: CanvasBlueprintDto)`
    - `delete_canvas_blueprint(blueprint_id: String)`
  - [x] 2.2 Wire commands into `generate_handler![]` in `src-tauri/src/lib.rs` and export in `commands/mod.rs`.
  - [x] 2.3 Create `src-tauri/capabilities/canvas.json` targeting `"windows": ["canvas-*"]` with required permissions (core, SQL, shell, events, window controls).

- [x] **3.0 Frontend DTOs, Services & Routing Integration**
  - [x] 3.1 Mirror canvas DTOs in `src/types/dto.ts` (`AppScope`, `CanvasNodeDto`, `CanvasWireDto`, `CanvasBlueprintDto`, `CanvasProjectLayoutDto`, `ViewportDto`).
  - [x] 3.2 Create `src/services/tauri/canvas.ts` providing typed wrappers for all canvas backend commands.
  - [x] 3.3 Add `"canvas"` to `PROJECT_DETAIL_TABS` in `src/lib/app-url.ts`.
  - [x] 3.4 Add i18n keys to `src/messages/en.ts` and `src/messages/de.ts` for canvas tab and actions.

- [x] **4.0 Core Canvas Surface & Viewport Engine**
  - [x] 4.1 Create `src/features/canvas/components/CanvasSurface.tsx` supporting:
    - Infinite 2D space with matrix transform `translate3d(panX, panY, 0) scale(zoom)`.
    - Pan gestures (middle-click, background drag).
    - Smooth zoom centered around mouse cursor.
    - Dot grid background with 16px snap toggle.
  - [x] 4.2 Create `useCanvasTransform.ts` managing viewport state and bounds clamping.
  - [x] 4.3 Create `CanvasToolbar.tsx` with controls: Scope Badge, Mode Switcher (`Auto` / `Freeform`), Recipe Dropdown, Add Node (`+`), Reset Zoom (`100%`), Pop-Out Window (`↗`).

- [x] **5.0 UI Modes (Auto-Layout vs. Freely Draggable)**
  - [x] 5.1 Implement **Freeform Draggable Mode**:
    - Pointer drag handlers on node header bars with coordinates updating in reactive store.
    - Snap-to-grid calculations (16px grid alignment).
    - Persist coordinates per project via SQLite.
  - [x] 5.2 Implement **Auto-Layout Mode**:
    - Hierarchical DAG layout algorithm in `autoLayout.ts`.
    - Organizes nodes into semantic vertical columns: `[Source/Tickets]` $\rightarrow$ `[Tasks/Docker]` $\rightarrow$ `[CI/Deploy/Observability]`.

- [x] **6.0 Intelligent Connection Wires & Correlation Engine**
  - [x] 6.1 Create `CanvasWiresOverlay.tsx` rendering SVG cubic bezier paths (`M x1,y1 C ... x2,y2`) between node ports.
  - [x] 6.2 Implement visual wire states:
    - **Nominal / Calm**: Low-opacity gradient line with directional particle pulse.
    - **Amber Alert (Desync)**: Pulsing amber wire with interactive action badge.
    - **Red Alert (Failure)**: Pulsing crimson red wire with alert glow and action chip.

- [x] **7.0 Context Node Card Components**
  - [x] 7.1 Create `CanvasNodeContainer.tsx` base component (header, drag handle, title, icon, status badge, action menu, pin toggle).
  - [x] 7.2 Implement `GitNode.tsx`: active branch, ahead/behind counters, dirty working tree, quick pull/push.
  - [x] 7.3 Implement `TaskNode.tsx`: dev server status, active processes, task triggers.
  - [x] 7.4 Implement `DockerNode.tsx`: container list, healthy/stopped status, restart compose button.
  - [x] 7.5 Implement `IssueNode.tsx`: linked Jira/GitHub issue, lane status, assignee.
  - [x] 7.6 Implement `CiNode.tsx`: CI pipeline run status, duration, rerun button.
  - [x] 7.7 Implement `DeployNode.tsx`: staging deployment status, commit SHA, health status.
  - [x] 7.8 Implement `NotesNode.tsx`: in-place editable markdown scratchpad for architecture notes.

- [x] **8.0 Floating In-Canvas Utility Windows**
  - [x] 8.1 Implement `FloatingTerminal.tsx`: interactive console embedded directly on canvas.
  - [x] 8.2 Implement `FloatingFilePreview.tsx`: syntax-highlighted viewer for `.env`, `docker-compose.yml`, `package.json`.
  - [x] 8.3 Implement `FloatingWebPreview.tsx`: embedded local webview iframe showing `http://localhost:3000` with reload.

- [x] **9.0 Recipes & Blueprints System with App Scopes**
  - [x] 9.1 Create built-in blueprint definitions in `src/features/canvas/blueprints/builtins.ts`:
    - `Full-Stack Web App` (`fullstack`)
    - `Backend & Microservice` (`server`)
    - `Single-Page Application` (`spa`)
    - `Desktop Application` (`desktop`)
    - `CLI & System Tool` (`cli`)
    - `Package / Library` (`library`)
    - `Solo Scrum Tracker` (`monorepo`)
  - [x] 9.2 Implement project marker auto-detection in `detector.ts` to detect AppScope and suggest matching blueprint.

- [x] **10.0 Multi-Window Flyout & Inter-Window Synchronization**
  - [x] 10.1 Create `canvas-window.html` and `src/canvas-window.tsx` standalone entrypoint.
  - [x] 10.2 Register `canvas-window` in `vite.config.ts` build inputs.
  - [x] 10.3 Implement `openCanvasWindow(projectId, initialOptions)` using Tauri `WebviewWindow` with monitor 2 detection.
  - [x] 10.4 Implement **"Follow Active Project" vs. "Pinned"** toggle in toolbar and inter-window event broadcast.
  - [x] 10.5 Embed `CanvasView` in `ProjectMainTabs.tsx` with pop-out action.

- [x] **11.0 Verification & Validation**
  - [x] 11.1 Backend Rust compilation verified via `cargo check` (finished with code 0).
  - [x] 11.2 Frontend type checking verified with zero canvas errors via `tsc --noEmit`.
  - [x] 11.3 Production Vite bundling verified via `bun run build` (built in 10.62s with code 0, bundling `canvas-window.html`).
