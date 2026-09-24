import { For, Show, createEffect, createSignal, type Component } from "solid-js";
import { readDir, type DirEntry } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";

import { cn } from "~/lib/utils";
import { Badge } from "~/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { FileIcon } from "~/components/FileIcon";
import { PluginIcon } from "~/components/PluginIcon";
import {
  fetchTabDecorations,
  getElementDecorations,
  decorationsVersion,
} from "~/lib/plugin/plugin-decorations";
import { getRelativePath, joinPathSync } from "~/lib/path-utils";
import {
  FileTreeContextMenu,
  type FileEntryOp,
} from "~/features/project-detail/components/FileTreeContextMenu";
import {
  SKIP,
  countFilesRecursively,
  recursiveCountCache,
  sameEntries,
  sortEntries,
} from "../model/fileTreeUtils";
import { FileItemRow } from "./FileItemRow";

export type FolderRowProps = {
  projectId: string;
  rootPath: string;
  absPath: string;
  label: string;
  depth: number;
  onFileClick: (path: string) => void;
  onFileDblClick: (path: string) => void;
  onDirClick: (path: string) => void;
  onEntryOp: (op: FileEntryOp) => void;
  selectedPath: string | null;
  refreshToken: number;
};

/**
 * Recursive folder row: listing, decorations, counts, child rows.
 * (Extracted verbatim from FileTree.tsx.)
 */
export const FolderRow: Component<FolderRowProps> = (props) => {
  const [open, setOpen] = createSignal(props.depth < 1);
  const [items, setItems] = createSignal<DirEntry[]>([]);
  const [loadErr, setLoadErr] = createSignal<string | null>(null);
  const [recursiveCount, setRecursiveCount] = createSignal<number | null>(
    recursiveCountCache.get(props.absPath) ?? null,
  );

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

  // Effect A — directory listing: re-reads when open state, path or the
  // tree refresh token changes. Deliberately does NOT subscribe to
  // decorationsVersion() so decoration-only updates can't rebuild the tree.
  let listSeq = 0;
  createEffect(() => {
    if (!open()) return;
    const absPath = props.absPath;
    // Reading the refresh token makes file operations re-read this directory;
    // capturing it lets a stale listing be discarded if another op lands first.
    const token = props.refreshToken;
    const seq = ++listSeq;
    void (async () => {
      try {
        const list = await readDir(absPath);
        if (seq !== listSeq || token !== props.refreshToken) return;
        const sorted = list.filter((e) => !SKIP.has(e.name)).sort(sortEntries);
        // Keep item identity stable: skip setItems when the visible listing
        // is unchanged so <For> doesn't tear down/recreate every child.
        setItems((prev) => (sameEntries(prev, sorted) ? prev : sorted));
        setLoadErr(null);
      } catch (e) {
        if (seq !== listSeq || token !== props.refreshToken) return;
        setLoadErr(String(e));
        setItems((prev) => (prev.length === 0 ? prev : []));
      }
    })();
  });

  // Effect B — decorations only: refetches badges/icons for the current
  // children when the global version bumps. Never touches items().
  createEffect(() => {
    if (!open()) return;
    decorationsVersion();
    const current = items();
    if (current.length === 0) return;
    const absPath = props.absPath;
    const rootPath = props.rootPath;
    const projectId = props.projectId;
    const relPaths = current.map((e) => getRelativePath(joinPathSync(absPath, e.name), rootPath));
    if (relPaths.length > 0) {
      void fetchTabDecorations(projectId, "files", relPaths);
    }
  });

  // Compute recursive file count once per path (cached + idle-deferred so a
  // full-tree remount doesn't pay O(n^2) reads on the critical path).
  createEffect(() => {
    if (recursiveCount() != null) return;
    const absPath = props.absPath;
    const schedule: (cb: () => void) => void =
      typeof requestIdleCallback !== "undefined"
        ? (cb) => requestIdleCallback(cb, { timeout: 2000 })
        : (cb) => setTimeout(cb, 0);
    schedule(() => {
      void (async () => {
        const count = await countFilesRecursively(absPath);
        recursiveCountCache.set(absPath, count);
        setRecursiveCount(count);
      })();
    });
  });

  const relFolder = () => getRelativePath(props.absPath, props.rootPath);
  const decs = () => getElementDecorations(props.projectId, "files", relFolder());
  const isRoot = () => props.depth === 0;

  return (
    <div class="font-mono text-[11px]">
      <FileTreeContextMenu
        isDirectory
        dirPath={props.absPath}
        path={isRoot() ? null : props.absPath}
        onOp={props.onEntryOp}
      >
        <div
          class="flex items-center gap-1 py-0.5 hover:bg-muted/30 cursor-pointer"
          style={{ "padding-left": `${props.depth * 12}px` }}
          onClick={() => {
            setOpen(!open());
            props.onDirClick(props.absPath);
          }}
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
                  <PluginIcon
                    icon={dec.icon}
                    class="size-3.5 shrink-0 cursor-pointer"
                    style={dec.color ? { color: dec.color } : undefined}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (dec.command) {
                        void invoke("execute_plugin_command", {
                          pluginId: dec.pluginId,
                          commandId: dec.command,
                          context: { projectId: props.projectId, elementId: relFolder() },
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
                    class={cn(
                      "h-4 px-1 text-[8px] font-bold cursor-pointer ml-1",
                      dec.color?.startsWith("bg-")
                        ? dec.color
                        : "bg-primary/10 text-primary border-primary/20",
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (dec.command) {
                        void invoke("execute_plugin_command", {
                          pluginId: dec.pluginId,
                          commandId: dec.command,
                          context: { projectId: props.projectId, elementId: relFolder() },
                        });
                      }
                    }}
                  >
                    <Show when={dec.icon}>
                      <PluginIcon icon={dec.icon} class="mr-0.5 size-2.5" />
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
            <span class="text-[9px] text-muted-foreground/60 ml-0.5">· {recursiveCount()}</span>
          </Show>
          <Show when={loadErr()}>
            <span class="truncate text-destructive">({loadErr()})</span>
          </Show>
        </div>
      </FileTreeContextMenu>
      <Show when={open()}>
        <For each={items()}>
          {(e) => (
            <Show
              when={e.isDirectory}
              fallback={
                <FileItemRow
                  projectId={props.projectId}
                  rootPath={props.rootPath}
                  parentAbs={props.absPath}
                  name={e.name}
                  depth={props.depth + 1}
                  onClick={props.onFileClick}
                  onDblClick={props.onFileDblClick}
                  onEntryOp={props.onEntryOp}
                  selected={props.selectedPath}
                />
              }
            >
              <FolderFromParent
                projectId={props.projectId}
                rootPath={props.rootPath}
                parentAbs={props.absPath}
                name={e.name}
                depth={props.depth + 1}
                onFileClick={props.onFileClick}
                onFileDblClick={props.onFileDblClick}
                onDirClick={props.onDirClick}
                onEntryOp={props.onEntryOp}
                selectedPath={props.selectedPath}
                refreshToken={props.refreshToken}
              />
            </Show>
          )}
        </For>
      </Show>
    </div>
  );
};

export type FolderFromParentProps = {
  projectId: string;
  rootPath: string;
  parentAbs: string;
  name: string;
  depth: number;
  onFileClick: (path: string) => void;
  onFileDblClick: (path: string) => void;
  onDirClick: (path: string) => void;
  onEntryOp: (op: FileEntryOp) => void;
  selectedPath: string | null;
  refreshToken: number;
};

/** Adapter: join parent+name, then render a FolderRow (no module cycle). */
export const FolderFromParent: Component<FolderFromParentProps> = (props) => {
  const absPath = () => joinPathSync(props.parentAbs, props.name);
  return (
    <FolderRow
      projectId={props.projectId}
      rootPath={props.rootPath}
      absPath={absPath()}
      label={props.name}
      depth={props.depth}
      onFileClick={props.onFileClick}
      onFileDblClick={props.onFileDblClick}
      onDirClick={props.onDirClick}
      onEntryOp={props.onEntryOp}
      selectedPath={props.selectedPath}
      refreshToken={props.refreshToken}
    />
  );
};
