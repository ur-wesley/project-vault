import { For, Show, createMemo, type Component } from "solid-js";
import { invoke } from "@tauri-apps/api/core";

import { cn } from "~/lib/utils";
import { Badge } from "~/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { FileIcon } from "~/components/FileIcon";
import { PluginIcon } from "~/components/PluginIcon";
import { getElementDecorations } from "~/lib/plugin/plugin-decorations";
import { getRelativePath, joinPathSync } from "~/lib/path-utils";
import {
  FileTreeContextMenu,
  type FileEntryOp,
} from "~/features/project-detail/components/FileTreeContextMenu";

export type FileItemRowProps = {
  projectId: string;
  rootPath: string;
  parentAbs: string;
  name: string;
  depth: number;
  onClick: (path: string) => void;
  onDblClick: (path: string) => void;
  onEntryOp: (op: FileEntryOp) => void;
  selected: string | null;
};

/**
 * Single file row with decorations + context menu.
 * (Extracted verbatim from FileTree.tsx.)
 */
export const FileItemRow: Component<FileItemRowProps> = (props) => {
  // Synchronous path concat: the previous async `join()` left absPath
  // undefined for a frame, gating render/click behind a pop-in.
  const absPath = createMemo(() => joinPathSync(props.parentAbs, props.name));

  const isSelected = () => absPath() === props.selected;
  const relFile = () => getRelativePath(absPath(), props.rootPath);
  const decs = () => getElementDecorations(props.projectId, "files", relFile());

  return (
    <FileTreeContextMenu
      isDirectory={false}
      dirPath={props.parentAbs}
      path={absPath()}
      onOp={props.onEntryOp}
    >
      <div
        class={cn(
          "flex items-center gap-1.5 py-0.5 pr-2 cursor-pointer transition-colors",
          isSelected()
            ? "bg-primary/15 text-primary"
            : "hover:bg-muted/50 text-foreground/70 hover:text-foreground",
        )}
        style={{ "padding-left": `${props.depth * 12 + 16}px` }}
        onClick={() => props.onClick(absPath())}
        onDblClick={() => props.onDblClick(absPath())}
      >
        <FileIcon name={props.name} class="h-3.5 w-3.5 opacity-90" />

        {/* Before File Decorations */}
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
                        context: { projectId: props.projectId, elementId: relFile() },
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
                        context: { projectId: props.projectId, elementId: relFile() },
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
      </div>
    </FileTreeContextMenu>
  );
};
