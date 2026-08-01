import { listen } from "@tauri-apps/api/event";
import { readDir, type DirEntry } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { For, Show, createEffect, createSignal, createMemo, onMount, onCleanup } from "solid-js";
import { createQuery } from "@tanstack/solid-query";
import { cn } from "~/lib/utils";
import { useI18n } from "~/lib/i18n-context";
import { searchProject, indexProject, rebuildIndex, getIndexMeta } from "~/services/tauri/search";
import { formatBytes } from "~/lib/format-bytes";
import { FilePreview } from "./components/FilePreview";
import { SearchResultItem } from "./components/SearchResultItem";
import { toast } from "solid-sonner";
import { notify } from "~/lib/notification-center";
import { queryKeys } from "~/services/query-keys";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { Badge } from "~/components/ui/badge";
import { invoke } from "@tauri-apps/api/core";
import { fetchTabDecorations, getElementDecorations, decorationsVersion } from "~/lib/plugin-decorations";
import { FileIcon } from "~/components/FileIcon";

const SKIP = new Set([
  "node_modules",
  ".git",
  "target",
  "dist",
  "build",
  ".turbo",
  ".next",
  ".nuxt",
  "__pycache__",
  ".venv",
  "venv",
  "vendor",
  ".idea",
  ".vs",
  "coverage",
  ".cache",
  "out",
  "bin",
  "obj",
]);

function sortEntries(a: DirEntry, b: DirEntry): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
  return a.name.localeCompare(b.name);
}

async function countFilesRecursively(absPath: string): Promise<number> {
  let count = 0;
  try {
    const entries = await readDir(absPath);
    for (const entry of entries) {
      if (SKIP.has(entry.name)) continue;
      if (entry.isDirectory) {
        const childPath = await join(absPath, entry.name);
        count += await countFilesRecursively(childPath);
      } else {
        count += 1;
      }
    }
  } catch {
    // ignore unreadable dirs
  }
  return count;
}

const getRelativePath = (abs: string, root: string) => {
  if (abs === root) return "";
  let rel = abs.substring(root.length);
  if (rel.startsWith("/") || rel.startsWith("\\")) {
    rel = rel.substring(1);
  }
  return rel.replace(/\\/g, "/");
};

function Folder(props: {
  projectId: string;
  rootPath: string;
  absPath: string;
  label: string;
  depth: number;
  onFileClick: (path: string) => void;
  selectedPath: string | null;
}) {
  const [open, setOpen] = createSignal(props.depth < 1);
  const [items, setItems] = createSignal<DirEntry[]>([]);
  const [loadErr, setLoadErr] = createSignal<string | null>(null);
  const [recursiveCount, setRecursiveCount] = createSignal<number | null>(null);

  createEffect(() => {
    const sel = props.selectedPath;
    if (!sel) return;
    const normAbs = props.absPath.replace(/\\/g, "/").replace(/\/$/, "");
    const normSel = sel.replace(/\\/g, "/").replace(/\/$/, "");
    const isSelfOrParent = normSel === normAbs || normSel.startsWith(normAbs + "/");
    if (isSelfOrParent) {
      setOpen(true);
    }
  });

  createEffect(() => {
    if (!open()) return;
    decorationsVersion();
    void (async () => {
      try {
        const list = await readDir(props.absPath);
        const sorted = list.filter((e) => !SKIP.has(e.name)).sort(sortEntries);
        setItems(sorted);
        setLoadErr(null);

        // Fetch decorations in batch for child paths
        const relPaths = sorted.map((e) => {
          const suffix = props.absPath.endsWith("/") || props.absPath.endsWith("\\") ? "" : "/";
          const childAbs = `${props.absPath}${suffix}${e.name}`;
          return getRelativePath(childAbs, props.rootPath);
        });
        if (relPaths.length > 0) {
          void fetchTabDecorations(props.projectId, "files", relPaths);
        }
      } catch (e) {
        setLoadErr(String(e));
        setItems([]);
      }
    })();
  });

  // Compute recursive file count once on mount (no need to open first)
  createEffect(() => {
    if (recursiveCount() != null) return;
    void (async () => {
      const count = await countFilesRecursively(props.absPath);
      setRecursiveCount(count);
    })();
  });

  const relFolder = () => getRelativePath(props.absPath, props.rootPath);
  const decs = () => getElementDecorations(props.projectId, "files", relFolder());

  return (
    <div class="font-mono text-[11px]">
      <div
        class="flex items-center gap-1 py-0.5 hover:bg-muted/30 cursor-pointer"
        style={{ "padding-left": `${props.depth * 12}px` }}
        onClick={() => setOpen(!open())}
      >
        <span
          class={cn(
            "size-4 flex items-center justify-center text-muted-foreground transition-transform",
            open() && "rotate-90",
          )}
        >
          <span class="iconify mdi--chevron-right h-3 w-3" />
        </span>
        <FileIcon name={props.label} isDirectory class="h-3.5 w-3.5" />
        
        {/* Before Folder Decorations */}
        <For each={decs().before}>
          {(dec) => (
            <Tooltip>
              <TooltipTrigger>
                <span 
                  class={cn("iconify size-3.5 shrink-0 cursor-pointer", dec.icon)} 
                  style={{ color: dec.color }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (dec.command) {
                      void invoke("execute_plugin_command", {
                        pluginId: dec.pluginId,
                        commandId: dec.command,
                        context: { projectId: props.projectId, elementId: relFolder() }
                      });
                    }
                  }}
                />
              </TooltipTrigger>
              <Show when={dec.tooltip}>
                <TooltipContent>{dec.tooltip}</TooltipContent>
              </Show>
            </Tooltip>
          )}
        </For>

        <span class="min-w-0 truncate text-foreground/90">{props.label}</span>

        {/* After Folder Decorations */}
        <For each={decs().after}>
          {(dec) => (
            <Tooltip>
              <TooltipTrigger>
                <Badge 
                  class={cn("h-4 px-1 text-[8px] font-bold cursor-pointer ml-1", dec.color?.startsWith("bg-") ? dec.color : "bg-primary/10 text-primary border-primary/20")}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (dec.command) {
                      void invoke("execute_plugin_command", {
                        pluginId: dec.pluginId,
                        commandId: dec.command,
                        context: { projectId: props.projectId, elementId: relFolder() }
                      });
                    }
                  }}
                >
                  <Show when={dec.icon}>
                    <span class={cn("iconify mr-0.5 size-2.5", dec.icon)} />
                  </Show>
                  {dec.label}
                </Badge>
              </TooltipTrigger>
              <Show when={dec.tooltip}>
                <TooltipContent>{dec.tooltip}</TooltipContent>
              </Show>
            </Tooltip>
          )}
        </For>

        <Show when={recursiveCount() != null}>
          <span class="text-[9px] text-muted-foreground/60 ml-0.5">
            · {recursiveCount()}
          </span>
        </Show>
        <Show when={loadErr()}>
          <span class="truncate text-destructive">({loadErr()})</span>
        </Show>
      </div>
      <Show when={open()}>
        <For each={items()}>
          {(e) => (
            <Show
              when={e.isDirectory}
              fallback={
                <FileItem
                  projectId={props.projectId}
                  rootPath={props.rootPath}
                  parentAbs={props.absPath}
                  name={e.name}
                  depth={props.depth + 1}
                  onClick={props.onFileClick}
                  selected={props.selectedPath}
                />
              }
            >
              <FileTreeFolderFromParent
                projectId={props.projectId}
                rootPath={props.rootPath}
                parentAbs={props.absPath}
                name={e.name}
                depth={props.depth + 1}
                onFileClick={props.onFileClick}
                selectedPath={props.selectedPath}
              />
            </Show>
          )}
        </For>
      </Show>
    </div>
  );
}

function FileItem(props: {
  projectId: string;
  rootPath: string;
  parentAbs: string;
  name: string;
  depth: number;
  onClick: (path: string) => void;
  selected: string | null;
}) {
  const [absPath, setAbsPath] = createSignal<string | undefined>();
  createEffect(() => {
    void join(props.parentAbs, props.name).then((p) => setAbsPath(p));
  });

  const isSelected = () => absPath() === props.selected;
  const relFile = () => absPath() ? getRelativePath(absPath()!, props.rootPath) : "";
  const decs = () => getElementDecorations(props.projectId, "files", relFile());

  return (
    <div
      class={cn(
        "flex items-center gap-1.5 py-0.5 pr-2 cursor-pointer transition-colors",
        isSelected()
          ? "bg-primary/15 text-primary"
          : "hover:bg-muted/50 text-foreground/70 hover:text-foreground",
      )}
      style={{ "padding-left": `${props.depth * 12 + 16}px` }}
      onClick={() => absPath() && props.onClick(absPath()!)}
    >
      <FileIcon name={props.name} class="h-3.5 w-3.5 opacity-90" />

      {/* Before File Decorations */}
      <For each={decs().before}>
        {(dec) => (
          <Tooltip>
            <TooltipTrigger>
              <span 
                class={cn("iconify size-3.5 shrink-0 cursor-pointer", dec.icon)} 
                style={{ color: dec.color }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (dec.command) {
                    void invoke("execute_plugin_command", {
                      pluginId: dec.pluginId,
                      commandId: dec.command,
                      context: { projectId: props.projectId, elementId: relFile() }
                    });
                  }
                }}
              />
            </TooltipTrigger>
            <Show when={dec.tooltip}>
              <TooltipContent>{dec.tooltip}</TooltipContent>
            </Show>
          </Tooltip>
        )}
      </For>

      <span class="truncate">{props.name}</span>

      {/* After File Decorations */}
      <For each={decs().after}>
        {(dec) => (
          <Tooltip>
            <TooltipTrigger>
              <Badge 
                class={cn("h-4 px-1 text-[8px] font-bold cursor-pointer ml-1", dec.color?.startsWith("bg-") ? dec.color : "bg-primary/10 text-primary border-primary/20")}
                onClick={(e) => {
                  e.stopPropagation();
                  if (dec.command) {
                    void invoke("execute_plugin_command", {
                      pluginId: dec.pluginId,
                      commandId: dec.command,
                      context: { projectId: props.projectId, elementId: relFile() }
                    });
                  }
                }}
              >
                <Show when={dec.icon}>
                  <span class={cn("iconify mr-0.5 size-2.5", dec.icon)} />
                </Show>
                {dec.label}
              </Badge>
            </TooltipTrigger>
            <Show when={dec.tooltip}>
              <TooltipContent>{dec.tooltip}</TooltipContent>
            </Show>
          </Tooltip>
        )}
      </For>
    </div>
  );
}

function FileTreeFolderFromParent(props: {
  projectId: string;
  rootPath: string;
  parentAbs: string;
  name: string;
  depth: number;
  onFileClick: (path: string) => void;
  selectedPath: string | null;
}) {
  const [absPath, setAbsPath] = createSignal<string | undefined>();
  createEffect(() => {
    void join(props.parentAbs, props.name).then((p) => setAbsPath(p));
  });
  return (
    <Show when={absPath()}>
      {(p) => (
        <Folder
          projectId={props.projectId}
          rootPath={props.rootPath}
          absPath={p()}
          label={props.name}
          depth={props.depth}
          onFileClick={props.onFileClick}
          selectedPath={props.selectedPath}
        />
      )}
    </Show>
  );
}

export function FileTree(props: {
  rootPath: string;
  projectId: string;
  subDetail?: string | null;
  onSubDetailChange?: (sub: string | null) => void;
}) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = createSignal(
    localStorage.getItem("pv-files-sidebar-collapsed") === "true"
  );

  createEffect(() => {
    localStorage.setItem("pv-files-sidebar-collapsed", String(collapsed()));
  });

  const [selectedPath, setSelectedPath] = createSignal<string | null>(null);

  createEffect(() => {
    const sub = props.subDetail;
    if (sub) {
      if (sub.includes("::")) {
        const [filePath, lineStr] = sub.split("::");
        const line = parseInt(lineStr || "0", 10);
        setSelectedPath(filePath);
        setPreviewPath(filePath);
        setScrollToLine(Number.isFinite(line) ? line : 0);
      } else {
        setSelectedPath(sub);
        setPreviewPath(sub);
        setScrollToLine(0);
      }
    }
  });
  const [scrollToLine, setScrollToLine] = createSignal(0);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [activeQuery, setActiveQuery] = createSignal("");
  const [previewPath, setPreviewPath] = createSignal<string | null>(null);
  const [indexBusy, setIndexBusy] = createSignal(false);

  const label = () => {
    const s = props.rootPath.replace(/\\/g, "/").replace(/\/+$/, "");
    const i = s.lastIndexOf("/");
    return i >= 0 ? s.slice(i + 1) : s;
  };

  const indexMetaQ = createQuery(() => ({
    queryKey: queryKeys.projectIndexMeta(props.projectId),
    queryFn: async () => {
      const r = await getIndexMeta(props.projectId);
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

  // Auto-build or rebuild index when component mounts
  createEffect(() => {
    const meta = indexMetaQ.data;
    if (indexBusy()) return;
    if (!meta) {
      setIndexBusy(true);
      void indexProject(props.projectId).then(
        () => setIndexBusy(false),
        () => setIndexBusy(false),
      );
      return;
    }
    const ONE_HOUR = 60 * 60 * 1000;
    if (meta.lastUpdatedMs && Date.now() - meta.lastUpdatedMs > ONE_HOUR) {
      setIndexBusy(true);
      void rebuildIndex(props.projectId).then(
        () => setIndexBusy(false),
        () => setIndexBusy(false),
      );
    }
  });

  // Listen for background index completion
  onMount(() => {
    let unlisten: (() => void) | undefined;
    void (async () => {
      unlisten = await listen<{ projectId: string }>("index:built", (ev) => {
        if (ev.payload.projectId === props.projectId) {
          void indexMetaQ.refetch();
          // Re-run an in-flight search so the result list reflects the
          // freshly-built index without the user having to retype.
          if (activeQuery().trim().length > 0) {
            void searchQ.refetch();
          }
        }
      });
    })();
    onCleanup(() => unlisten?.());
  });

  const searchQ = createQuery(() => ({
    queryKey: queryKeys.projectSearch(props.projectId, activeQuery()),
    queryFn: async () => {
      const q = activeQuery().trim();
      if (!q) return [];
      const r = await searchProject(props.projectId, q);
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
    searchTimeout = setTimeout(() => {
      setActiveQuery(value);
    }, 200);
  };

  const onIndexProject = async () => {
    setIndexBusy(true);
    try {
      const r = await indexProject(props.projectId);
      if (r.isErr()) {
        toast.error(r.error.message);
        return;
      }
      notify({
        severity: "success",
        title: t("projectDetail.indexProject") as string,
        source: "Search",
        system: "auto",
      });
      void indexMetaQ.refetch();
    } finally {
      setIndexBusy(false);
    }
  };

  const onRebuildIndex = async () => {
    setIndexBusy(true);
    try {
      const r = await rebuildIndex(props.projectId);
      if (r.isErr()) {
        toast.error(r.error.message);
        return;
      }
      notify({
        severity: "success",
        title: t("projectDetail.rebuildIndex") as string,
        source: "Search",
        system: "auto",
      });
      void indexMetaQ.refetch();
    } finally {
      setIndexBusy(false);
    }
  };

  const isSearching = () => activeQuery().trim().length > 0;

  // Sort by score (highest first) and include path-only matches. The backend
  // is the source of truth for what counts as a hit; the frontend only orders.
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

  const [scrollToQuery, setScrollToQuery] = createSignal("");

  const onResultClick = (path: string, line: number, query: string) => {
    setPreviewPath(path);
    setScrollToLine(line);
    setScrollToQuery(query);
    props.onSubDetailChange?.(`${path}::${line}`);
  };

  const onBackToResults = () => {
    setPreviewPath(null);
    setScrollToLine(0);
    setScrollToQuery("");
    props.onSubDetailChange?.(null);
  };

  const onFileTreeClick = (path: string) => {
    setSelectedPath(path);
    setPreviewPath(path);
    setScrollToLine(0);
    props.onSubDetailChange?.(path);
  };

  return (
    <div
      class={cn(
        "flex h-full min-h-0 overflow-hidden p-3 transition-all duration-200",
        collapsed() ? "gap-2" : "gap-4"
      )}
    >
      <div
        class={cn(
          "shrink-0 overflow-auto rounded-md border border-border/60 bg-muted/20 scrollbar-none flex flex-col gap-2 transition-all duration-200 ease-in-out",
          collapsed() ? "w-0 p-0 border-none opacity-0" : "w-64 p-2 opacity-100"
        )}
      >
        <div class="flex items-center gap-1.5">
          <div class="relative flex-1">
            <span class="iconify mdi--magnify absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              class="w-full rounded-md bg-background border border-border/60 pl-7 pr-7 py-1 text-[11px] font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              placeholder={t("projectDetail.searchFiles") as string}
              value={searchQuery()}
              onInput={(e) => onSearchInput(e.currentTarget.value)}
            />
            <Show when={searchQuery().length > 0}>
              <button
                class="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setSearchQuery("");
                  setActiveQuery("");
                  setPreviewPath(null);
                  setScrollToLine(0);
                }}
              >
                <span class="iconify mdi--close h-3 w-3" />
              </button>
            </Show>
          </div>

          <Show when={!indexMetaQ.data}>
            <Tooltip>
              <TooltipTrigger
                as="button"
                type="button"
                class="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-2 py-1 text-[10px] font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                disabled={indexBusy()}
                onClick={onIndexProject}
              >
                <Show when={indexBusy()}>
                  <span class="iconify mdi--loading animate-spin h-3 w-3" />
                </Show>
                <span class="iconify mdi--database-plus h-3.5 w-3.5" />
              </TooltipTrigger>
              <TooltipContent>{t("projectDetail.indexProject") as string}</TooltipContent>
            </Tooltip>
          </Show>

          <Show when={indexMetaQ.data}>
            {(meta) => (
              <Popover gutter={4}>
                <Tooltip>
                  <TooltipTrigger as="div">
                    <PopoverTrigger
                      as="button"
                      type="button"
                      class="inline-flex shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
                    >
                      <span class="iconify mdi--dots-vertical h-4 w-4" />
                    </PopoverTrigger>
                  </TooltipTrigger>
                  <TooltipContent>{t("projectDetail.searchResults") as string}</TooltipContent>
                </Tooltip>
                <PopoverContent class="w-56 p-2.5 space-y-2 text-foreground shadow-xl border-border/40">
                  <div class="space-y-1.5">
                    <div class="flex items-center justify-between">
                      <span class="text-[9px] text-muted-foreground uppercase tracking-wider">
                        {t("projectDetail.indexedFiles") as string}
                      </span>
                      <span class="text-[10px] font-mono font-bold">{meta().indexedFiles}</span>
                    </div>
                    <div class="flex items-center justify-between">
                      <span class="text-[9px] text-muted-foreground uppercase tracking-wider">
                        {t("projectDetail.indexSize") as string}
                      </span>
                      <span class="text-[10px] font-mono font-bold">{formatBytes(meta().indexSizeBytes)}</span>
                    </div>
                    <div class="flex items-center justify-between">
                      <span class="text-[9px] text-muted-foreground uppercase tracking-wider">
                        {t("projectDetail.lastUpdated") as string}
                      </span>
                      <span class="text-[10px] font-mono">
                        {(() => {
                          const ms = meta().lastUpdatedMs;
                          return ms != null ? new Date(ms).toLocaleString() : "—";
                        })()}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    class="w-full inline-flex items-center justify-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[10px] font-bold text-muted-foreground hover:bg-muted/30 disabled:opacity-50"
                    disabled={indexBusy()}
                    onClick={onRebuildIndex}
                  >
                    <Show when={indexBusy()}>
                      <span class="iconify mdi--loading animate-spin h-3 w-3" />
                    </Show>
                    {t("projectDetail.rebuildIndex") as string}
                  </button>
                </PopoverContent>
              </Popover>
            )}
          </Show>

          <Tooltip>
            <TooltipTrigger
              as="button"
              type="button"
              onClick={() => setCollapsed(true)}
              class="inline-flex shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors cursor-pointer"
            >
              <span class="iconify mdi--chevron-left h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent>Collapse Sidebar</TooltipContent>
          </Tooltip>
        </div>

        <div class="flex-1 overflow-auto">
          <Folder
            projectId={props.projectId}
            rootPath={props.rootPath}
            absPath={props.rootPath}
            label={label()}
            depth={0}
            onFileClick={onFileTreeClick}
            selectedPath={selectedPath()}
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
        <div class="flex-1 min-w-0 h-full overflow-hidden">
          <Show
            when={previewPath()}
            fallback={
              <Show
                when={isSearching()}
                fallback={<FilePreview path={selectedPath()} projectRoot={props.rootPath} scrollToLine={scrollToLine()} onNavigate={onFileTreeClick} />}
              >
                <div class="h-full flex flex-col min-w-0 bg-card/50 rounded-md border border-border/40 overflow-hidden">
                  <div class="flex items-center justify-between px-3 py-1.5 bg-muted/20 border-b border-border/40 shrink-0">
                    <div class="flex items-center gap-2 min-w-0">
                      <span class="iconify mdi--magnify h-3.5 w-3.5 text-muted-foreground" />
                      <span class="text-[10px] font-mono text-muted-foreground truncate">
                        {t("projectDetail.searchResults") as string}
                      </span>
                    </div>
                    <Show when={searchQ.isLoading}>
                      <span class="text-[9px] text-muted-foreground animate-pulse">
                        {t("projectDetail.searchLoading") as string}
                      </span>
                    </Show>
                  </div>
                  <div class="flex-1 overflow-auto p-3 space-y-2">
                    <Show when={!searchQ.isLoading && filteredHits().length === 0}>
                      <div class="flex items-center justify-center h-full text-muted-foreground text-xs italic">
                        {t("projectDetail.searchEmpty") as string}
                      </div>
                    </Show>
                    <For each={filteredHits()}>
                      {(hit) => (
                        <SearchResultItem
                          hit={hit}
                          rootPath={props.rootPath}
                          topScore={topScore()}
                          query={searchQuery()}
                          onClick={onResultClick}
                        />
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            }
          >
            {(path) => (
              <FilePreview
                path={path()}
                projectRoot={props.rootPath}
                scrollToLine={scrollToLine()}
                scrollToQuery={scrollToQuery()}
                onBackToResults={isSearching() ? onBackToResults : undefined}
                backLabel={t("projectDetail.searchResults") as string}
                onNavigate={onFileTreeClick}
              />
            )}
          </Show>
        </div>
      </div>
    </div>
  );
}
