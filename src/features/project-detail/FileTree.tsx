import { stat } from "@tauri-apps/plugin-fs";
import { Show, createEffect, createSignal } from "solid-js";
import { cn } from "~/lib/utils";
import { useI18n } from "~/lib/i18n-context";
import { useEventHub } from "~/lib/event-hub-context";
import { FilePreview } from "./components/FilePreview";
import { FileEditorTabs } from "./components/FileEditorTabs";
import { FileEntryDialog } from "./components/FileEntryDialog";
import { FolderRow } from "./components/FolderRow";
import { FileSearchBar } from "./components/FileSearchBar";
import { SearchResults } from "./components/SearchResults";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { toast } from "solid-sonner";
import { createFileTabsModel } from "./model/fileTabsModel";
import { createFileSearchModel } from "./model/useFileSearch";
import { createFileWatcherModel } from "./model/useFileWatcher";
import { createFileOpsModel } from "./model/useFileOps";

export function FileTree(props: {
  rootPath: string;
  projectId: string;
  subDetail?: string | null;
  onSubDetailChange?: (sub: string | null) => void;
}) {
  const { t } = useI18n();
  const hub = useEventHub();
  const [collapsed, setCollapsed] = createSignal(
    localStorage.getItem("pv-files-sidebar-collapsed") === "true",
  );

  createEffect(() => {
    localStorage.setItem("pv-files-sidebar-collapsed", String(collapsed()));
  });

  const [selectedPath, setSelectedPath] = createSignal<string | null>(null);
  const [previewPath, setPreviewPath] = createSignal<string | null>(null);
  const [refreshToken, setRefreshToken] = createSignal(0);
  const [scrollRequest, setScrollRequest] = createSignal<
    { path: string; line: number; nonce: number } | undefined
  >(undefined);
  let scrollNonce = 0;

  const model = createFileTabsModel({
    projectId: props.projectId,
    onError: (error) => toast.error(error.message),
  });

  // Search + index domain lives in model/useFileSearch.
  const search = createFileSearchModel({ projectId: props.projectId, t });
  // File-entry ops live in model/useFileOps.
  const ops = createFileOpsModel({
    model,
    setRefreshToken,
    selectedPath,
    setSelectedPath,
    previewPath,
    setPreviewPath,
    onSubDetailChange: props.onSubDetailChange,
  });
  // Watcher + editor shortcuts live in model/useFileWatcher.
  createFileWatcherModel({ model, hub });

  const bumpScroll = (path: string, line: number) => {
    scrollNonce += 1;
    setScrollRequest({ path, line, nonce: scrollNonce });
  };

  createEffect(() => {
    const sub = props.subDetail;
    if (!sub) return;
    if (sub.includes("::")) {
      const [filePath, lineStr] = sub.split("::");
      const line = parseInt(lineStr || "0", 10);
      setSelectedPath(filePath);
      setPreviewPath(filePath);
      void model
        .openFile(filePath)
        .then(() => bumpScroll(filePath, Number.isFinite(line) ? line : 0));
    } else {
      // File selection lives in the sidebar tree only: directories just
      // highlight there, files open an editor tab. The content pane never
      // shows a browsable directory listing.
      setSelectedPath(sub);
      void (async () => {
        try {
          const info = await stat(sub);
          if (!info.isDirectory) {
            setPreviewPath(sub);
            await model.openPreview(sub);
          }
        } catch {
          // gone — selection only
        }
      })();
    }
  });

  const label = () => {
    const s = props.rootPath.replace(/\\/g, "/").replace(/\/+$/, "");
    const i = s.lastIndexOf("/");
    return i >= 0 ? s.slice(i + 1) : s;
  };

  const isSearching = () => search.activeQuery().trim().length > 0;

  const onResultClick = (path: string, line: number, _query: string) => {
    setSelectedPath(path);
    setPreviewPath(path);
    void model.openPreview(path).then(() => bumpScroll(path, line));
    props.onSubDetailChange?.(`${path}::${line}`);
  };

  const onBackToResults = () => {
    setPreviewPath(null);
    props.onSubDetailChange?.(null);
  };

  /** Single click in the sidebar tree: open as a reusable preview tab. */
  const onFileTreeClick = (path: string) => {
    setSelectedPath(path);
    setPreviewPath(path);
    void model.openPreview(path);
    props.onSubDetailChange?.(path);
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
    props.onSubDetailChange?.(path);
  };

  /** Content-pane navigation: files open a tab, directories select the tree. */
  const onNavigatePath = (path: string, isDirectory?: boolean) => {
    if (isDirectory === false) {
      onFileTreeClick(path);
    } else {
      onDirTreeClick(path);
    }
  };

  const showResults = () => isSearching() && previewPath() === null;
  const showEmpty = () => previewPath() === null && !isSearching() && !model.activeTab();
  const overlayVisible = () => showResults() || showEmpty();

  return (
    <div
      class={cn(
        "flex h-full min-h-0 overflow-hidden p-3 transition-all duration-200",
        collapsed() ? "gap-2" : "gap-4",
      )}
    >
      <div
        class={cn(
          "shrink-0 overflow-auto rounded-md border border-border/60 bg-muted/20 scrollbar-none flex flex-col gap-2 transition-all duration-200 ease-in-out",
          collapsed() ? "w-0 p-0 border-none opacity-0" : "w-64 p-2 opacity-100",
        )}
      >
        <FileSearchBar
          t={t}
          search={search}
          onCollapse={() => setCollapsed(true)}
          onSearchInput={(v) => search.onSearchInput(v, () => setPreviewPath(null))}
          onClearSearch={() =>
            search.clearSearch(() => setPreviewPath(model.activeTab()?.path ?? null))
          }
        />

        <div class="flex-1 overflow-auto">
          <FolderRow
            projectId={props.projectId}
            rootPath={props.rootPath}
            absPath={props.rootPath}
            label={label()}
            depth={0}
            onFileClick={onFileTreeClick}
            onFileDblClick={onFileTreePin}
            onDirClick={onDirTreeClick}
            onEntryOp={ops.onEntryOp}
            selectedPath={selectedPath()}
            refreshToken={refreshToken()}
          />
        </div>
      </div>

      <div class="flex-1 min-w-0 h-full overflow-hidden flex gap-3">
        <Show when={collapsed()}>
          <Tooltip>
            <TooltipTrigger
              as="button"
              type="button"
              onClick={() => setCollapsed(false)}
              class="shrink-0 h-full w-6 bg-muted/10 hover:bg-muted/20 border border-border/40 hover:border-border/60 rounded-md flex items-center justify-center transition-all duration-200 group cursor-pointer"
            >
              <span class="iconify mdi--chevron-right h-4 w-4 text-muted-foreground group-hover:text-foreground transition-transform group-hover:scale-110" />
            </TooltipTrigger>
            <TooltipContent>Expand Sidebar</TooltipContent>
          </Tooltip>
        </Show>
        <div class="relative flex-1 min-w-0 h-full overflow-hidden">
          {/* Editor stack stays mounted so per-tab undo history survives. */}
          <div
            class={cn("absolute inset-0", overlayVisible() && "invisible pointer-events-none")}
            aria-hidden={overlayVisible()}
          >
            <FileEditorTabs
              model={model}
              projectRoot={props.rootPath}
              active={!overlayVisible()}
              scrollRequest={scrollRequest()}
              onNavigate={onNavigatePath}
              onBackToResults={isSearching() ? onBackToResults : undefined}
              backLabel={t("projectDetail.searchResults") as string}
            />
          </div>

          <Show when={showResults()}>
            <SearchResults
              t={t}
              search={search}
              rootPath={props.rootPath}
              onResultClick={onResultClick}
            />
          </Show>

          <Show when={showEmpty()}>
            <div class="absolute inset-0 overflow-hidden rounded-md border border-border/40 bg-card">
              <FilePreview path={null} projectRoot={props.rootPath} />
            </div>
          </Show>
        </div>
      </div>

      <FileEntryDialog
        request={ops.entryRequest()}
        onClose={() => ops.setEntryRequest(null)}
        onConfirm={(request, value) => void ops.onEntryConfirm(request, value)}
      />
    </div>
  );
}
