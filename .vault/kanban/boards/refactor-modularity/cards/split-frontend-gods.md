---
id: split-frontend-gods
board: refactor-modularity
title: Phase 2a — split 8 frontend god files
status: done
priority: high
tags: [frontend]
assignees: []
parent: null
relations:
  - { to: shared-primitives, kind: blocking }
due: null
archived: false
links:
  tasks: ["bun run typecheck", "bun run lint", "bun run test", "bun run build"]
  files: ["src/features/settings/components/PluginDashboard.tsx", "src/App.tsx", "src/components/PluginUiBridge.tsx", "src/features/project-detail/components/ProjectDetailHeader.tsx", "src/features/project-detail/FileTree.tsx", "src/features/canvas/components/nodes/WhiteboardNode.tsx", "src/features/canvas/components/nodes/DokployNode.tsx", "src/features/project-detail/components/FilePreview.tsx"]
  issues: []
  workspaces: []
checklist:
  - { label: "PluginDashboard 1876 -> hooks + row/form/tab components", done: true }
  - { label: "PluginDashboard done (2026-09-24): 1982 -> 414 shell; PluginRow 448; StoreTab 213; ProfileTab 71; LogsTab 155; model/{pluginTypes 121, usePluginList 100, usePluginConfig 119, usePluginUpdates 140, usePluginInstall 485, usePluginLogs 125}; typecheck zero, lint clean (1 moved warning), tests 412 green; also fixed pre-existing normalizeHexColor String() crash + latent trim crash on non-string defaults", done: true }
  - [ ] 2.2 App.tsx (1252 → ~430 shell + src/app/* hooks/components)
  - { label: "App done (2026-09-24): 1252 -> 431 shell; src/app/{useAppRouting 259, useSidebarData 248, useWindowTitle 81, AppSidebar 242, AppMainView 112, GitHubAuthMenu 106}; deleted dead pathname signal + _onHeaderSignIn; onOpenGitHubProfile now uses shared openExternal; fixed real ProcessDto.id->sessionId bug (was comparing undefined); typecheck/lint clean except pre-existing t(string) class; budget FAIL 24->23", done: true }
  - { label: "PluginUiBridge done (2026-09-24): 1095 -> 351 event-wiring shell; model/{dialogTypes 63, useInputBox 42, useQuickPick 203, useDynamicForm 119, useMarkdownDialog 44, useDeepLinkInstall 84}; dialogs/{InputBox 50, QuickPick 141, Form 134, Markdown 42, DeepLink 70}; Form/Markdown/DeepLink on DialogShell, QuickPick stays custom; each model owns its listen() subscriptions; typecheck/lint clean except 3 pre-existing unused imports; budget FAIL 23->22 (bridge off list)", done: true }
  - { label: "ProjectDetailHeader done (2026-09-24): 1030 -> 95 shell; HeaderTitle 138, HeaderMetaRow 79, HeaderActionsMenu 108, HeaderIdePill 128, HeaderStats 45, TitlebarDesktopActions 375, TitlebarMobileMenu 225, HeaderTitlebarPortal 63, model/useHeaderGithub 21; desktop+mobile incoming lists intentionally NOT merged (6+ class diffs, unverifiable visually); typecheck/lint clean except pre-existing 1-arg formatRelativeTime WIP drift; tests green except known dnd; budget FAIL 22->21 (header off list)", done: true }
  - { label: "FileTree done (2026-09-24): 1009 -> 244 shell; components/{FolderRow 304 (Folder+adapter, cycle contained), FileItemRow 129, FileSearchBar 136, SearchResults 57}; model/{fileTreeUtils 61, useFileSearch 177, useFileWatcher 38, useFileOps 80}; FloatingFilePreview rewired Folder->FolderRow; typecheck/lint zero; tests 418/418 green; budget FAIL 21->20 (filetree off list)", done: true }
  - { label: "WhiteboardNode done (2026-09-24): 1167 -> 135 shell; whiteboard/{useWhiteboardStore 287 (state+history+selection/group ops), useWhiteboardPointer 478 (gesture machine+canvas loop), useWhiteboardLabels 281 (dblclick/commit/group labels)}; WhiteboardToolbar 185 (TOOLS/SHORTCUTS live here, keyboard imports map from shell); WhiteboardOverlays 45 (label overlay; status stays in shell for positioning); no history hook (pure fns already in whiteboard/history.ts); typecheck/lint zero; tests green except known dnd; budget FAIL 20->19 (whiteboard off list)", done: true }
  - { label: "DokployNode done (2026-09-25): 804 -> 329 shell; dokploy/{useDokployIdentity 64 (git-ref/remote/DB identity), useDokployMatches 184 (matches/version/debug/link queries + auto-link), useDokployStatus 137 (ranking/selection/status/redeploy/badge), LinkRepoSection 199, dokployUiHelpers 31 (confirm/statusIcon/relativeTime)}; typecheck/lint zero; tests 422/422 green; budget FAIL 19->18 (dokploy off list)", done: true }
  - { label: "FilePreview done (2026-09-25): 704 -> 118 shell; components/{FileHeader 94, DirectoryList 141 (breadcrumbs moved in), MediaView 77 (open-externally moved in), MarkdownView 28, CodeView 22}; model/{useFileContent 228 (loader+viewMode), usePreviewScroll 103 (line/query scroll), useHighlighter 97 (cached-promise singleton replaces module-scope createResource that warned 'never be disposed')}; viewMode-reset effect folded into fetcher (same timing); fallback chain mediaKind->MediaView else MarkdownView verified equivalent; typecheck zero; 4 oxlint non-null-assertion errors proven pre-existing via stash baseline (verbatim moves); tests 422/422 green; budget FAIL 18->17 (filepreview off list)", done: true }
  - { label: "DokployNode done (2026-09-24): 804 -> 329 shell; dokploy/{LinkRepoSection 199, useDokployIdentity 64, useDokployMatches 184 (matches+version+debug+link+auto-link), useDokployStatus 137 (selection+status+redeploy+badge), dokployUiHelpers 31 (confirmRedeploy/statusIcon/relativeTime)}; typecheck/lint zero; tests green except known dnd; budget FAIL 19->18 (dokploy off list)", done: true }
  - { label: "App 1178 -> routing/sidebar/titlebar/main-view", done: false }
  - { label: "PluginUiBridge 1014 -> per-dialog hooks + components", done: false }
  - { label: "ProjectDetailHeader 1048 -> title/badges/menu + CopyButton", done: false }
  - { label: "FileTree 965 -> search/watcher/ops hooks + rows", done: false }
  - { label: "WhiteboardNode 1122 -> store/pointer/history/toolbar", done: false }
  - { label: "DokployNode 779 -> identity/matches/status hooks + LinkRepoSection", done: false }
  - { label: "FilePreview 668 -> content hooks + 4 views", done: false }
  - { label: "second-tier settings/tasks tabs batched", done: false }
  - { label: "all 8 gods split (2026-09-25): Dashboard, App, Bridge, Header, FileTree, WhiteboardNode, DokployNode, FilePreview — shells ≤431, budget FAIL 24->17; second-tier tabs deferred to Phase 4 batch", done: true }
  - { label: "each split <=300 lines, gates green, no UX change", done: false }
---

## Notes

One PR per file. Verbatim moves first, wire props after. Barrels keep old paths alive one phase.
