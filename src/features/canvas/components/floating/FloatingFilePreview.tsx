import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from "solid-js";
import { createQuery } from "@tanstack/solid-query";
import { stat } from "@tauri-apps/plugin-fs";
import { toast } from "solid-sonner";
import { CanvasNodeContainer, type CanvasNodeComponentProps } from "../nodes/CanvasNodeContainer";
import { FileEditorTabs } from "~/features/project-detail/components/FileEditorTabs";
import {
  FileEntryDialog,
  type FileEntryRequest,
} from "~/features/project-detail/components/FileEntryDialog";
import type { FileEntryOp } from "~/features/project-detail/components/FileTreeContextMenu";
import { FolderRow } from "~/features/project-detail/components/FolderRow";
import { SearchResultItem } from "~/features/project-detail/components/SearchResultItem";
import { FileIcon } from "~/components/FileIcon";
import { queryKeys } from "~/services/query-keys";
import { getIndexMeta, searchProject } from "~/services/tauri/search";
import { watchProjectFiles } from "~/services/tauri/files";
import { createFileTabsModel, fileNameOf } from "~/features/project-detail/model/fileTabsModel";
import { ensureProjectIndex, subscribeIndexBuilt } from "../../live/projectIndex";
import { useI18n } from "~/lib/i18n-context";
import { joinPathSync, parentDirOf } from "~/lib/path-utils";
import { useEventHub } from "~/lib/event-hub-context";

type PersistedTab = { path: string; preview: boolean };
type FileNodeData = {
  tabs?: Array<string | PersistedTab>;
  active?: string | null;
};

function parseFileNodeData(raw: string | null | undefined): {
  tabs: PersistedTab[];
  active: string | null;
} {
  if (!raw) return { tabs: [], active: null };
  try {
    const parsed = JSON.parse(raw) as FileNodeData;
    if (typeof parsed !== "object" || parsed === null) return { tabs: [], active: null };
    const tabs: PersistedTab[] = Array.isArray(parsed.tabs)
      ? parsed.tabs.flatMap((t): PersistedTab[] => {
          if (typeof t === "string") return [{ path: t, preview: false }];
          if (typeof t === "object" && t !== null && typeof t.path === "string") {
            return [{ path: t.path, preview: t.preview === true }];
          }
          return [];
        })
      : [];
    return {
      tabs,
      active: typeof parsed.active === "string" ? parsed.active : (tabs[0]?.path ?? null),
    };
  } catch {
    return { tabs: [], active: null };
  }
}

function baseName(abs: string): string {
  return fileNameOf(abs);
}

/**
 * Full IDE node: project explorer beside the exact same tabbed editor stack
 * as the Files tab (FileEditorTabs + fileTabsModel). Tabs are independent
 * per node and persisted in the node's dataJson.
 */
export const FloatingFilePreview: Component<CanvasNodeComponentProps> = (props) => {
  const { t } = useI18n();
  const hub = useEventHub();
  const projectId = () => props.project().id;
  const rootPath = () => props.project().path;

  const model = createFileTabsModel({
    projectId: props.project().id,
    onError: (error) => toast.error(error.message),
  });

  const stored = createMemo(() => parseFileNodeData(props.node.dataJson));
  const [restored, setRestored] = createSignal(false);
  const [selectedPath, setSelectedPath] = createSignal<string | null>(null);
  const [previewPath, setPreviewPath] = createSignal<string | null>(null);
  const [refreshToken, setRefreshToken] = createSignal(0);
  const [entryRequest, setEntryRequest] = createSignal<FileEntryRequest | null>(null);
  const [scrollRequest, setScrollRequest] = createSignal<
    { path: string; line: number; nonce: number } | undefined
  >(undefined);
  let scrollNonce = 0;

  const [searchQuery, setSearchQuery] = createSignal("");
  const [activeQuery, setActiveQuery] = createSignal("");
  const [indexBusy, setIndexBusy] = createSignal(false);

  const persist = (nextTabs: PersistedTab[], nextActive: string | null) => {
    props.onDataChange?.(props.node.id, JSON.stringify({ tabs: nextTabs, active: nextActive }));
  };

  // Persist tab list + active tab (preview flags included) on every change.
  createEffect(() => {
    if (!restored()) return;
    const nextTabs = model.state.tabs.map((tab) => ({ path: tab.path, preview: tab.preview }));
    const nextActive = model.activeTab()?.path ?? null;
    persist(nextTabs, nextActive);
  });

  // Restore persisted tabs; drop files deleted while the canvas was closed.
  onMount(() => {
    const initial = stored();
    if (initial.tabs.length === 0) {
      setRestored(true);
      return;
    }
    void (async () => {
      const kept: PersistedTab[] = [];
      for (const tab of initial.tabs) {
        try {
          const info = await stat(tab.path);
          if (!info.isDirectory) kept.push(tab);
        } catch {
          // gone — drop the tab
        }
      }
      for (const tab of kept) {
        if (tab.preview) {
          await model.openPreview(tab.path);
        } else {
          await model.openFile(tab.path);
        }
      }
      const active =
        initial.active && kept.some((tab) => tab.path === initial.active)
          ? initial.active
          : (kept[0]?.path ?? null);
      if (active) {
        model.setActive(active);
        setSelectedPath(active);
        setPreviewPath(active);
      }
      setRestored(true);
    })();
  });

  // Keep the backend watcher pointed at the currently open files.
  createEffect(() => {
    const paths = model.watcherPaths();
    void watchProjectFiles(paths);
  });

  const bumpScroll = (path: string, line: number) => {
    scrollNonce += 1;
    setScrollRequest({ path, line, nonce: scrollNonce });
  };

  /** Single click in the sidebar tree: open as a reusable preview tab. */
  const onFileTreeClick = (path: string) => {
    setSelectedPath(path);
    setPreviewPath(path);
    void model.openPreview(path);
  };

  /** Double click in the sidebar tree: pin the preview tab so it stays. */
  const onFileTreePin = (path: string) => {
    setSelectedPath(path);
    setPreviewPath(path);
    void model.openPreview(path).then(() => model.pinTab(path));
  };

  /**
   * Directory selection lives in the sidebar tree only (expand/highlight).
   * It never swaps the content pane to a directory listing.
   */
  const onDirTreeClick = (path: string) => {
    setSelectedPath(path);
  };

  /** Content-pane navigation: files open a tab, directories select the tree. */
  const onNavigatePath = (path: string, isDirectory?: boolean) => {
    if (isDirectory === false) {
      onFileTreeClick(path);
    } else {
      onDirTreeClick(path);
    }
  };

  const onEntryOp = (op: FileEntryOp) => setEntryRequest(op);

  const onEntryConfirm = async (request: FileEntryRequest, value: string) => {
    if (request.kind === "newFile") {
      const result = await model.createFile(request.dirPath, value);
      if (result.ok) {
        setRefreshToken((n) => n + 1);
        const created = joinPathSync(request.dirPath, value);
        setSelectedPath(created);
        setPreviewPath(created);
      }
    } else if (request.kind === "newFolder") {
      const result = await model.createFolder(request.dirPath, value);
      if (result.ok) setRefreshToken((n) => n + 1);
    } else if (request.kind === "rename") {
      const to = joinPathSync(parentDirOf(request.path), value);
      const result = await model.renamePath(request.path, to);
      if (result.ok) {
        setRefreshToken((n) => n + 1);
        const remap = (p: string | null) =>
          p &&
          (p === request.path ||
            p.startsWith(`${request.path}/`) ||
            p.startsWith(`${request.path}\\`))
            ? to + p.slice(request.path.length)
            : p;
        setSelectedPath((p) => remap(p));
        setPreviewPath((p) => remap(p));
      }
    } else {
      const result = await model.deletePath(request.path);
      if (result.ok) {
        setRefreshToken((n) => n + 1);
        const isAffected = (p: string | null) =>
          !!p &&
          (p === request.path ||
            p.startsWith(`${request.path}/`) ||
            p.startsWith(`${request.path}\\`));
        if (isAffected(selectedPath())) setSelectedPath(null);
        if (isAffected(previewPath())) setPreviewPath(null);
      }
    }
    setEntryRequest(null);
  };

  // ---- File search (same Tantivy index as the Files tab) ----
  const indexMetaQ = createQuery(() => ({
    queryKey: queryKeys.projectIndexMeta(projectId()),
    queryFn: async () => {
      const r = await getIndexMeta(projectId());
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

  createEffect(() => {
    const meta = indexMetaQ.data;
    if (indexBusy()) return;
    if (!meta) {
      setIndexBusy(true);
      // Shared across nodes: concurrent triggers for the same project
      // collapse into a single index build instead of N parallel ones.
      void ensureProjectIndex(projectId()).then(
        () => setIndexBusy(false),
        () => setIndexBusy(false),
      );
    }
  });

  onMount(() => {
    // One process-wide Tauri listener shared by all file nodes on the canvas.
    const unsubIndex = subscribeIndexBuilt((pid) => {
      if (pid === projectId()) {
        void indexMetaQ.refetch();
        if (activeQuery().trim().length > 0) void searchQ.refetch();
      }
    });
    onCleanup(unsubIndex);
  });

  // Registry-dispatched file actions (rebindable in Settings). Gated on node
  // focus so multiple file nodes + the Files tab don't double-handle saves.
  // Find/goto/format need the editor apis and are handled in FileEditorTabs.
  onMount(() => {
    const unlistenWatch = model.initWatcher();
    const unsubShortcuts = hub.on("shortcut:action", ({ action }) => {
      if (!(props.isFocused ?? true)) return;
      if (overlayVisible()) return;
      const path = model.activeTab()?.path;
      if (action === "file:save" && path) void model.save(path);
      else if (action === "file:save-all") void model.saveAll();
      else if (action === "file:close-tab" && path) model.requestClose(path);
    });
    onCleanup(() => {
      unlistenWatch();
      unsubShortcuts();
    });
  });

  const searchQ = createQuery(() => ({
    queryKey: queryKeys.projectSearch(projectId(), activeQuery()),
    queryFn: async () => {
      const q = activeQuery().trim();
      if (!q) return [];
      const r = await searchProject(projectId(), q);
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    enabled: activeQuery().trim().length > 0,
  }));

  let searchTimeout: ReturnType<typeof setTimeout> | null = null;
  const onSearchInput = (value: string) => {
    setSearchQuery(value);
    setPreviewPath(null); // show search results again while typing
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => setActiveQuery(value), 200);
  };
  onCleanup(() => {
    if (searchTimeout) clearTimeout(searchTimeout);
  });

  const clearSearch = () => {
    setSearchQuery("");
    setActiveQuery("");
    setPreviewPath(model.activeTab()?.path ?? null);
  };

  const isSearching = () => activeQuery().trim().length > 0;
  const filteredHits = createMemo(() => {
    const data = searchQ.data;
    if (!data) return [];
    return [...data].sort((a, b) => b.score - a.score);
  });
  const topScore = createMemo(() => {
    const data = searchQ.data;
    if (!data || data.length === 0) return 0;
    return Math.max(...data.map((h) => h.score));
  });

  const onResultClick = (path: string, line: number, _query: string) => {
    setSearchQuery("");
    setActiveQuery("");
    setSelectedPath(path);
    setPreviewPath(path);
    void model.openPreview(path).then(() => bumpScroll(path, line));
  };

  const onBackToResults = () => {
    setPreviewPath(null);
  };

  const showResults = () => isSearching() && previewPath() === null;
  const showEmpty = () => previewPath() === null && !isSearching() && !model.activeTab();
  const overlayVisible = () => showResults() || showEmpty();
  /** Editor shortcuts (find/goto/format/close-tab) only fire when focused. */
  const editorActive = () => !overlayVisible() && (props.isFocused ?? true);

  const rootLabel = () => {
    const s = rootPath().replace(/\\/g, "/").replace(/\/+$/, "");
    const i = s.lastIndexOf("/");
    return i >= 0 ? s.slice(i + 1) : s;
  };

  const badge = () => {
    const active = model.activeTab()?.path;
    return active ? baseName(active) : "Files";
  };

  return (
    <CanvasNodeContainer
      node={{ ...props.node, width: props.node.width || 720 }}
      icon="mdi--file-code-outline"
      badge={badge()}
      isDraggable={props.isDraggable}
      snapEnabled={props.snapEnabled}
      zoom={props.zoom}
      onPositionChange={props.onPositionChange}
      onResize={props.onResize}
      onDelete={props.onDelete}
      onPinToggle={props.onPinToggle}
      isFocused={props.isFocused}
      isFullscreen={props.isFullscreen}
      onFocusNode={props.onFocusNode}
      onToggleFullscreen={props.onToggleFullscreen}
      onTitleChange={props.onTitleChange}
      onStartDrag={props.onStartDrag}
    >
      {/* Stop wheel over the IDE from zooming the canvas — panes scroll instead. */}
      <div class="flex min-h-[320px] min-w-0 flex-1 gap-2" onWheel={(e) => e.stopPropagation()}>
        {/* Explorer sidebar (same tree + context menu as the Files tab) */}
        <aside class="flex w-40 shrink-0 flex-col gap-1.5 overflow-hidden border-r border-border/40 pr-2">
          <div class="relative shrink-0">
            <span class="iconify mdi--magnify absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              class="w-full rounded-md border border-border/60 bg-background py-1 pl-7 pr-6 font-mono text-[10px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              placeholder={t("projectDetail.searchFiles") as string}
              value={searchQuery()}
              onInput={(e) => onSearchInput(e.currentTarget.value)}
            />
            <Show when={searchQuery().length > 0}>
              <button
                type="button"
                class="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={clearSearch}
              >
                <span class="iconify mdi--close h-3 w-3" />
              </button>
            </Show>
          </div>
          <div class="min-h-0 flex-1 overflow-auto">
            <FolderRow
              projectId={projectId()}
              rootPath={rootPath()}
              absPath={rootPath()}
              label={rootLabel()}
              depth={0}
              onFileClick={onFileTreeClick}
              onFileDblClick={onFileTreePin}
              onDirClick={onDirTreeClick}
              onEntryOp={onEntryOp}
              selectedPath={selectedPath()}
              refreshToken={refreshToken()}
            />
          </div>
        </aside>

        {/* Editor pane: same FileEditorTabs stack as the Files tab, with
            search / empty overlays on top (same pattern). File selection
            lives in the sidebar tree only. */}
        <div class="relative flex min-h-0 min-w-0 flex-1">
          {/* Editor stays mounted so per-tab undo history survives overlays. */}
          <div
            class="absolute inset-0"
            classList={{ "invisible pointer-events-none": overlayVisible() }}
            aria-hidden={overlayVisible()}
          >
            <FileEditorTabs
              model={model}
              projectRoot={rootPath()}
              active={editorActive()}
              scrollRequest={scrollRequest()}
              onNavigate={onNavigatePath}
              onBackToResults={isSearching() ? onBackToResults : undefined}
              backLabel={t("projectDetail.searchResults") as string}
            />
          </div>

          <Show when={showResults()}>
            <div class="absolute inset-0 flex min-w-0 flex-col overflow-hidden rounded-md border border-border/40 bg-card">
              <div class="flex shrink-0 items-center gap-2 border-b border-border/40 px-1 pb-1.5">
                <span class="iconify mdi--magnify h-3.5 w-3.5 text-muted-foreground" />
                <span class="truncate font-mono text-[10px] text-muted-foreground">
                  {t("projectDetail.searchResults") as string}
                </span>
                <Show when={searchQ.isLoading}>
                  <span class="animate-pulse text-[9px] text-muted-foreground">
                    {t("projectDetail.searchLoading") as string}
                  </span>
                </Show>
              </div>
              <div class="min-h-0 flex-1 space-y-2 overflow-auto py-2">
                <Show
                  when={!searchQ.isLoading && filteredHits().length === 0}
                  fallback={
                    <For each={filteredHits()}>
                      {(hit) => (
                        <SearchResultItem
                          hit={hit}
                          rootPath={rootPath()}
                          topScore={topScore()}
                          query={searchQuery()}
                          onClick={onResultClick}
                        />
                      )}
                    </For>
                  }
                >
                  <div class="flex h-full items-center justify-center text-xs italic text-muted-foreground">
                    {t("projectDetail.searchEmpty") as string}
                  </div>
                </Show>
              </div>
            </div>
          </Show>

          <Show when={showEmpty()}>
            <div class="absolute inset-0 flex flex-col items-center justify-center gap-2 overflow-hidden rounded-md border border-border/40 bg-card p-4 text-center">
              <FileIcon name="placeholder.txt" class="h-8 w-8 opacity-40" />
              <p class="font-mono text-[10px] italic text-muted-foreground">
                {t("projectDetail.selectFilePreview") as string}
              </p>
            </div>
          </Show>
        </div>
      </div>

      <FileEntryDialog
        request={entryRequest()}
        onClose={() => setEntryRequest(null)}
        onConfirm={(request, value) => void onEntryConfirm(request, value)}
      />
    </CanvasNodeContainer>
  );
};
