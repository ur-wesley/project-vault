> **SUPERSEDED** by the full-repo refactor tracked on board `refactor-modularity` (.vault/kanban/boards/refactor-modularity/) + docs/BEST_PRACTICES.md. Kept for history.

# Tasks: Frontend Modularity, DX & De-duplication

**PRD:** [`prd-frontend-modularity.md`](./prd-frontend-modularity.md)

**Principles:** SOLID (SRP/ISP — 1 file = 1 reason to change), DRY (dedupe on 3rd occurrence only), KISS (fold > abstract, colocate > new folder), YAGNI (delete one blueprint path, fold one-call wrappers, no new frameworks).

**Budgets:** warn >300 lines, fail >600 lines (`src/**/*.{ts,tsx}`, excl. generated + `messages/`). Verify every parent task with `bun run typecheck && bun run lint && bun run test`.

## Relevant Files

- `src/features/settings/components/PluginDashboard.tsx` (~1876) — 7 responsibilities; split into hooks + row/form/tab components.
- `src/App.tsx` (~1178) — 10 responsibilities, 11 queries, 18 signals; split into routing/sidebar/titlebar/main-view.
- `src/components/PluginUiBridge.tsx` (~1014) — footer/header/pages + 4 dialog systems; split into per-dialog hooks + components.
- `src/features/project-detail/components/ProjectDetailHeader.tsx` (~1048, 48x `<Show>`) — title/badges/menu/5 dialogs; split + `CopyButton`.
- `src/features/project-detail/FileTree.tsx` (~965, 4 components) — recursion + watcher + search + tabs; split into hooks + row components.
- `src/features/canvas/components/nodes/WhiteboardNode.tsx` (~1122, 13 signals, ~22 handlers) — FSM + history + persist + toolbar; split store/pointer/history/UI.
- `src/features/canvas/components/nodes/DokployNode.tsx` (~779, 15 memos, 10 queries) — identity/ranking/status/link flow; split hooks + `LinkRepoSection`.
- `src/features/project-detail/components/FilePreview.tsx` (~668) — stat/media/code/markdown/dir; split content hooks + 4 views.
- `src/features/canvas/layout/wireGeometry.ts` (~663, 26 fns) — ports/bezier/avoidance/sampling; split 4 ways.
- `src/features/canvas/components/nodes/whiteboard/geometry.ts` (~625, 34 fns) — bounds/hit-test/resize/polyline/connectors; split 5 ways.
- `src/types/dto.ts` (~589, ~50 types) — god module; slice by domain, keep barrel.
- `src/services/tauri/dokploy.ts` (15KB) + `dokploy.test.ts` — god service; move to `features/dokploy/`.
- `src/services/tauri/` (29 files, no barrel) — 10 trivial wrappers (`processes.ts` 181B, `pickers.ts`, `updates.ts`, `notifications.ts`, `autostart.ts`, `scanning.ts`, `settings.ts`, `project-cleaner.ts`, `mise.ts`, `ide.ts`); core is `utils.ts` (`mapInvokeError`, `tauriInvoke`).
- `src/lib/` (46 files, no barrel) — single-fn modules (`format-bytes.ts`, `session-state.ts` 5 lines, `task-risk.ts`, `project-icon.ts`, `rescan-library.ts`, `sync-project-tasks-cache.ts`); outliers `app-url.ts` (254 lines), `shortcut-context.tsx` + `shortcut-registry.ts` + `use-scoped-shortcut.ts`, `notification-center.tsx`, 7x `plugin-*.ts`.
- `src/lib/notification-center.tsx` (store) vs `src/components/NotificationCenter.tsx` (UI) — rename collision.
- `src/features/canvas/` — `geometry/` vs `layout/` vs `whiteboard/` triple home; `nodes/` vs `components/nodes/` split; `state/` micro-stores (`linking`, `wiresStore`, `portSchemas`, `persistence`, `manualWires` vs `dataflow`, `nodesStore`); `blueprints/detector.ts` vs `detectors.ts` duality; `index.ts` only re-exports `CanvasView`.
- Dialogs: `src/features/locations/components/LocationProjectCleanerDialog.tsx` (~522), `src/features/project-detail/components/CleanProjectDialog.tsx`, `src/features/project-detail/components/TaskEditorDialog.tsx`, `src/features/project-wizard/NewProjectWizardDialog.tsx`, 5 inline dialogs in `PluginUiBridge`.
- Settings tabs: `GeneralSettingsTab.tsx` (613), `TasksTabPanel.tsx` (614), `McpSettingsTab.tsx` (556), `useSettingsModel.ts` (518), `Templates/Accounts/Shortcuts/ToolsSettingsTab.tsx` (250–350 each).
- `src/messages/de.ts` (1161) / `en.ts` (1136) — ~25-line drift, no sync test.
- `tsconfig.json` — alias `~/*` → `./src/*` already exists.

### Notes

- Keep every split behavior-preserving: move code verbatim first, then wire props. Old import paths stay alive via barrel re-export for one phase.
- One parent task = one PR. Land Phase 1 before Phase 2 (splits consume the shared primitives).
- Grep-before-delete: `rg "openExternal|invokeErrorMessage|joinPathSync|getRelativePath|formatRelativeTime|fuzzyMatch|normalizeHexColor|detectProjectScope|task-stream-dialog|CanvasIconSafelist"` to prove single-definition after each dedupe.

## Instructions for Completing Tasks

As you complete each task, change `- [ ]` to `- [x]` in this file. Update the file after each sub-task, not just after a parent task.

## Tasks

- [ ] 0.0 Guardrails + barrels (no behavior change)
  - [ ] 0.1 Add line-budget script (`scripts/check-file-budget.mjs`): warn >300, fail >600 on `src/**/*.{ts,tsx}` excl. `messages/` + generated. Wire into `package.json` (`lint:budget`) and CI. Prove it passes/fails on a fixture.
  - [ ] 0.2 Add barrels (re-export only, no moves): `src/lib/index.ts`, `src/services/tauri/index.ts`, `src/features/canvas/layout/index.ts`, `src/features/canvas/state/index.ts`. Keep deep imports working.
  - [ ] 0.3 Add i18n key-sync test: `src/messages/messages.test.ts` asserting `de.ts`/`en.ts` export identical key sets (catches the ~25-line drift). No message edits here.
  - [ ] 0.4 Rename `src/lib/notification-center.tsx` → `src/lib/notification-store.tsx` (store: `NotificationCenterProvider`, `notify()`, `dismissNotification()`, `useNotificationCenter()`). Update import in `src/components/NotificationCenter.tsx:9-14` + all consumers. No logic change.
  - [ ] 0.5 Gate: `bun run typecheck && bun run lint && bun run test && bun run build` green.

- [ ] 1.0 Shared primitives (DRY — each duplicate exists once)
  - [ ] 1.1 `lib/open-external.ts`: extract `openExternal = isTauri()? openUrl : window.open` from `ProjectDetailHeader` + `DokployNode` (+ inline in `App`). Replace 3 definitions with 1 import. Verify with `rg "const openExternal|function openExternal"` → 1 hit.
  - [ ] 1.2 `lib/path-utils.ts`: extract `joinPathSync/parentDirOf/getRelativePath` from `FileTree.tsx` + `FilePreview.tsx`. Replace both local copies. Verify `rg "getRelativePath|joinPathSync"` definitions → 1 module.
  - [ ] 1.3 Unify errors: delete local `invokeErrorMessage` in `PluginDashboard.tsx`; use `stableErrorMessage` from `lib/invoke-error.ts` everywhere (`App`, `DokployNode` already use it). Verify `rg "invokeErrorMessage"` → 0 local defs.
  - [ ] 1.4 Single time helper: consolidate `relativeTime` (Dokploy) + `livePlaytime` (header) wrappers into `lib/format-date.ts:formatRelativeTime`. Remove wrappers.
  - [ ] 1.5 `components/DialogShell.tsx`: extract `Dialog+Header+Title+Footer+Button` shell used 4x in `PluginUiBridge` (input/quickPick/form/markdown at :711/:739/:859/:973/:1009) + 4x feature dialogs (`LocationProjectCleanerDialog:267`, `TaskEditorDialog:207`, `NewProjectWizardDialog:243`, `CleanProjectDialog:91`). Shell takes `title/footer/actions/children`. Migrate `PluginUiBridge` dialogs first, feature dialogs in 2.x.
  - [ ] 1.6 `components/CopyButton.tsx`: extract `copiedPath/copiedRemote` copy-button logic (2 identical blocks in `ProjectDetailHeader`) + 6 tooltip-wrapped buttons. Props: `value/label`.
  - [ ] 1.7 Fold helpers: move `fuzzyMatch` (PluginUiBridge) → existing `lib/fuzzy-score.ts`; move `normalizeHexColor` (PluginDashboard) → `lib/` (e.g. `lib/color.ts` or `lib/format.ts`). Delete originals.
  - [ ] 1.8 Gate: grep single-definition proofs + `typecheck/lint/test` green.

- [ ] 2.0 Split god files (SRP — one PR per file, verbatim moves)
  - [ ] 2.1 `PluginDashboard.tsx` (1876 → ≤300/file):
    - [ ] 2.1.1 `settings/hooks/usePluginList.ts` (fetch + `asPluginOptionList/asPluginConfigList`, toggle/uninstall).
    - [ ] 2.1.2 `settings/hooks/usePluginInstall.ts` (git/local/monorepo/discovered: `commitLocalInstall` + `handleRelinkLocal` merge — they are near-identical).
    - [ ] 2.1.3 `settings/hooks/usePluginUpdates.ts` (check/update/update-all/sync-lockfile/restore).
    - [ ] 2.1.4 `settings/hooks/usePluginLogs.ts` (log filter `seen Set` + `filteredLogs` + autoscroll).
    - [ ] 2.1.5 `settings/components/PluginRow.tsx` + `PluginConfigForm.tsx` (config field renderers per `PluginConfigItem`).
    - [ ] 2.1.6 `settings/components/{StoreTab,LogsTab,ProfileTab}.tsx` (tab bodies out of the shell).
    - [ ] 2.1.7 Thin `PluginDashboard.tsx` = composition only. Gate: file ≤300 lines, `typecheck/lint/test` green.
  - [ ] 2.2 `App.tsx` (1178 → ≤300/file):
    - [ ] 2.2.1 `hooks/useAppRouting.ts` (`readAppUrl/pushUrl*` + `openProject/openPluginPage/runPluginPageCommand`).
    - [ ] 2.2.2 `hooks/useSidebarData.ts` (11 queries + filter memos + pin revision).
    - [ ] 2.2.3 `components/AppSidebar.tsx` (~200-line sidebar JSX), `AppTitleBar.tsx`, `AppMainView.tsx` (nav/header/main `activeView` branches — 4 branch sites become 1 router).
    - [ ] 2.2.4 `components/GitHubAuthMenu.tsx` (auth menu + `onSignOut/onOpenGitHubProfile`).
    - [ ] 2.2.5 Thin `App.tsx`. Gate: same as 2.1.7.
  - [ ] 2.3 `PluginUiBridge.tsx` (1014 → hooks + dialogs on `DialogShell`):
    - [ ] 2.3.1 `plugin-ui/useQuickPick.ts` (+ `filteredQpItems`), `useInputBox.ts`, `useDynamicForm.ts` (+ validation), `useMarkdownDialog.ts`.
    - [ ] 2.3.2 `plugin-ui/dialogs/{QuickPickDialog,FormDialog,MarkdownDialog,DeepLinkDialog}.tsx` (resolve-on-submit `invoke→close` triplication becomes 1 helper).
    - [ ] 2.3.3 Thin `PluginUiBridge.tsx` (footer/header/pages mirrors only).
  - [ ] 2.4 `ProjectDetailHeader.tsx` (1048, 48x `<Show>` → ≤300/file):
    - [ ] 2.4.1 `components/HeaderTitle.tsx`, `HeaderMetaBadges.tsx` (`IntegrationsBar/LanguageBar`, playtime, pin), `HeaderActionsMenu.tsx` (dropdown + `useHeaderGithub.ts`).
    - [ ] 2.4.2 Adopt `CopyButton` (1.6) + `openExternal` (1.1). 5 dialogs stay separate files; header keeps thin wiring.
  - [ ] 2.5 `FileTree.tsx` (965, 4 components → hooks + rows):
    - [ ] 2.5.1 Adopt `lib/path-utils.ts` (1.2); extract `hooks/useFileSearch.ts` (index/search `onIndexProject/onRebuildIndex`), `useFileWatcher.ts` (`watchProjectFiles+eventHub`), `useFileOps.ts` (context-menu + `FileEntryDialog` ops).
    - [ ] 2.5.2 `components/FolderRow.tsx` (recursive `Folder` + `absPath` memo — kill the `Folder`/`FileItem` double memo), `components/SearchResults.tsx` (preview routing `previewPath/scrollToLine`).
  - [ ] 2.6 `WhiteboardNode.tsx` (1122 → store + FSM + UI):
    - [ ] 2.6.1 `whiteboard/useWhiteboardStore.ts` (elements + `lastSavedRaw+saveTimer` debounced persist), `useWhiteboardHistory.ts` (undo/redo), `useWhiteboardPointer.ts` (select/freehand/rect/ellipse/diamond/arrow/line/text/eraser/marquee FSM + `eraseAt/applyMove/groupSel/deleteSelected/commitLabel`).
    - [ ] 2.6.2 `whiteboard/WhiteboardToolbar.tsx` (`TOOLS[9]`, `TOOL_SHORTCUTS`, `COLORS/WIDTHS`), `WhiteboardOverlays.tsx` (labels/marquee/bind highlights). Geometry stays in `whiteboard/geometry*` (Phase 3).
  - [ ] 2.7 `DokployNode.tsx` (779, 15 memos → ≤300/file):
    - [ ] 2.7.1 `dokploy/useDokployIdentity.ts` (git identity), `useDokployMatches.ts` (ranking/selection), `useDokployStatus.ts` (poll + redeploy confirm).
    - [ ] 2.7.2 `dokploy/LinkRepoSection.tsx` (own file), `dokploy/dokploy-ui-helpers.ts` (`openExternal/confirmRedeploy/relativeTime/statusIcon` shared with header — consumes 1.1/1.4).
  - [ ] 2.8 `FilePreview.tsx` (711 → hooks + 4 views):
    - [ ] 2.8.1 `hooks/useHighlighter.ts` (replace module-global `[highlighter]` singleton resource), `hooks/useFileContent.ts` (stat + size guard + content/dir resources).
    - [ ] 2.8.2 `components/{CodeView,MarkdownView,MediaView,DirectoryList}.tsx` (shiki 30-lang map + `EXT_LANG_MAP/FILENAME_LANG_MAP` move next to existing `lib/preview-media.ts:getPreviewMediaKind`). Breadcrumbs reuse tree nav.
  - [ ] 2.9 Second-tier tabs (same pattern, batch after 2.1–2.8 green): `GeneralSettingsTab` (613), `TasksTabPanel` (614), `McpSettingsTab` (556), `Templates/Accounts/Shortcuts/ToolsSettingsTab` (250–350), `useSettingsModel.ts` (518) → per-tab `useXModel.ts` + row/form components; `SettingsView.tsx` (248) becomes composition.

- [ ] 3.0 Canvas consolidation (KISS — one home per concept)
  - [ ] 3.1 Merge `canvas/geometry/` → `canvas/layout/`: move `measuredSizes.tsx` (`DEFAULT_NODE_SIZE`), `fullscreen.ts`; fix `layout/wireGeometry.ts:2` import; delete empty `geometry/` dir. Update `layout/index.ts` barrel.
  - [ ] 3.2 Split `layout/wireGeometry.ts` (719, 0 signals, 26 fns) → `wire-ports.ts` (dims/getWirePorts), `wire-avoidance.ts` (inflate/seg-intersect/countHits/unionRect/bypass/corridor/routeAvoiding/pairScore), `wire-path.ts` (cubicAt/flattenCubic/buildChain/fmt), `wire-sample.ts` (nearEndpoint/samples). Barrel re-export keeps `resolveWireGeometry/resolveAnchoredGeometry/wirePathSamples` stable. Existing tests keep passing.
  - [ ] 3.3 Split `whiteboard/geometry.ts` (664, 34 fns, ~20 exports) → `geometry/{bounds,hit-test,resize,polyline,connectors}.ts` + barrel. Fix `0.55*fontSize` magic number shared with `boundText.ts:getTextBounds` (single constant). Consumers (`WhiteboardNode`, `render.ts`, `bindings.ts`) import from barrel.
  - [ ] 3.4 Unify nodes: merge `canvas/nodes/` (`allNodes`, `registry`, `types`, `base/BaseNode`) + `canvas/components/nodes/` (`Whiteboard/Dokploy/Git/Task/Zettel/Notes`, `CanvasNodeContainer`, `CanvasNodeRenderer`) under one `canvas/nodes/` (subfolders `base/`, `whiteboard/`, `dokploy/`). Registry vs renderer boundary documented in 1 paragraph at top of `registry.ts`.
  - [ ] 3.5 Merge micro-stores: `state/{linking,wiresStore,manualWires,persistence}` → `state/wires-store.ts`; `flyout/{openCanvasWindow,windowSync}` → one module; `webview/previewUrl.ts` (274B) into parent; keep `webview/eventBus.ts` factory, delete any remaining ad-hoc `Map<Set<subscribe` clones (grep to prove).
  - [ ] 3.6 Blueprints duality (YAGNI): delete legacy `blueprints/detector.ts:detectProjectScope` OR new `detectors.ts` registry — decide by reading `blueprints/index.ts:2,35,42` + `hooks/useCanvasState.ts:7,74`. Remove fallback branch, update the one caller. Gate: `rg "detectProjectScope"` → 0 or registry-only.
  - [ ] 3.7 Gate: `canvas/geometry/` gone, budgets pass, `typecheck/lint/test/build` green.

- [ ] 4.0 Services / types slicing (ISP/DIP at the Tauri boundary only)
  - [ ] 4.1 Slice `src/types/dto.ts` by domain → `features/canvas/types.ts` (`Canvas*Dto` ~90 lines), `features/locations/cleaner.ts` (`ProjectCleaner*` ~60 lines), plus `GitHubDevice*`, `Mise*`, `Clipboard*` to their feature homes. `dto.ts` becomes ≤50-line re-export barrel for one phase, then callers migrate to domain imports.
  - [ ] 4.2 Move `services/tauri/dokploy.ts` + `dokploy.test.ts` → `features/dokploy/` (service + `DOKPLOY_API_VERSION`, `DokployServer`, match kinds + test move together). Leave re-export in `services/tauri/` for one phase.
  - [ ] 4.3 Fold trivial wrappers (YAGNI): `processes.ts` (181B), `pickers.ts`, `updates.ts`, `notifications.ts`, `autostart.ts`, `scanning.ts`, `settings.ts`, `project-cleaner.ts`, `mise.ts`, `ide.ts` → fold into callers or `services/tauri/core.ts` around `utils.ts:mapInvokeError/tauriInvoke`. No new interfaces; delete empty modules.
  - [ ] 4.4 `lib/plugin-*.ts` (decorations, footer, header-widgets, icon, log-store, page-pins, pages) → `lib/plugin/` folder + `index.ts` barrel.
  - [ ] 4.5 Gate: `dto.ts` ≤50 lines, `services/tauri/` has barrel + no one-call modules without a caller justification comment.

- [ ] 5.0 DX polish + convention lock-in
  - [ ] 5.1 Enforce budget in CI (fail >600). Add `lint:budget` to required checks alongside `typecheck/lint/test`.
  - [ ] 5.2 Standardize global stores: pick context vs store (`event-hub-context` vs `global-terminal-store` vs `live-playtime-context`) — one pattern for new code, document in `docs/ARCHITECTURE.md` (1 page: feature layout, barrel policy, dialog/store/error conventions).
  - [ ] 5.3 Barrel single-fn `lib/` utils where imported 3+ times (`format-bytes` 13 importers, `invoke-error` 20+, `rescan-library`, `preview-media`); colocate the rest with their sole caller. Keep `*.test.ts` colocation.
  - [ ] 5.4 Dead-code sweep (prove with grep + build): `components/CanvasIconSafelist.tsx`, unused `components/dnd/` strategy, `components/task-stream-dialog.tsx` vs `EmbeddedTerminal.tsx` (tasks file already flags redundancy), `lib/session-state.ts` (5 lines), `lib/task-risk.ts` brittle allowlist. Delete or merge with justification per item.
  - [ ] 5.5 Final gate: zero files >600, all new/edited ≤300 (or waived with comment), `bun run typecheck && bun run lint && bun run test && bun run build` green, budget script green.
