import { For, type Component } from "solid-js";

import { cn } from "~/lib/utils";
import { canRedo, canUndo } from "./whiteboard/history";
import type { WhiteboardTool } from "./whiteboard/types";
import type { WhiteboardStore } from "./whiteboard/useWhiteboardStore";
import type { WhiteboardLabels } from "./whiteboard/useWhiteboardLabels";
import { StylePanel } from "./whiteboard/StylePanel";

export const TOOLS: { id: WhiteboardTool; icon: string; label: string; key: string }[] = [
  { id: "select", icon: "mdi--cursor-default", label: "Select / move", key: "V" },
  { id: "freehand", icon: "mdi--pencil", label: "Freehand", key: "P" },
  { id: "rectangle", icon: "mdi--rectangle-outline", label: "Rectangle", key: "R" },
  { id: "ellipse", icon: "mdi--ellipse-outline", label: "Ellipse", key: "O" },
  { id: "diamond", icon: "mdi--diamond-outline", label: "Diamond", key: "D" },
  { id: "arrow", icon: "mdi--arrow-right", label: "Arrow (binds to shapes)", key: "A" },
  { id: "line", icon: "mdi--minus", label: "Line (binds to shapes)", key: "L" },
  { id: "text", icon: "mdi--format-text", label: "Text", key: "T" },
  { id: "eraser", icon: "mdi--eraser", label: "Eraser", key: "E" },
];

export const TOOL_SHORTCUTS: Record<string, WhiteboardTool> = {
  v: "select",
  p: "freehand",
  r: "rectangle",
  o: "ellipse",
  d: "diamond",
  a: "arrow",
  l: "line",
  t: "text",
  e: "eraser",
};

/** Tool row + contextual Excalidraw-like style panel. */
export const WhiteboardToolbar: Component<{
  store: WhiteboardStore;
  openGroupLabel: WhiteboardLabels["openGroupLabel"];
}> = (props) => {
  const { store } = props;

  return (
    <>
      {/* Tool row */}
      <div
        class="flex flex-wrap items-center gap-0.5 pb-2"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <For each={TOOLS}>
          {(t) => (
            <button
              type="button"
              title={`${t.label} (${t.key})`}
              aria-label={t.label}
              aria-pressed={store.tool() === t.id}
              onClick={() => {
                store.setTool(t.id);
                store.setSelectedIds([]);
              }}
              class={cn(
                "rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                store.tool() === t.id && "bg-primary/15 text-primary",
              )}
            >
              <span class={cn("iconify size-4", t.icon)} />
            </button>
          )}
        </For>
        <div class="mx-1 h-4 w-px bg-border/60" />
        <button
          type="button"
          title="Undo"
          aria-label="Undo"
          disabled={!canUndo(store.hist())}
          onClick={store.undo}
          class="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
        >
          <span class="iconify mdi--undo size-4" />
        </button>
        <button
          type="button"
          title="Redo"
          aria-label="Redo"
          disabled={!canRedo(store.hist())}
          onClick={store.redo}
          class="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
        >
          <span class="iconify mdi--redo size-4" />
        </button>
        <button
          type="button"
          title="Clear board"
          aria-label="Clear board"
          disabled={store.count() === 0}
          onClick={() => {
            if (store.count() === 0) return;
            store.setSelectedIds([]);
            store.commit([]);
          }}
          class="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive disabled:opacity-30"
        >
          <span class="iconify mdi--trash-can-outline size-4" />
        </button>
        <div class="mx-1 h-4 w-px bg-border/60" />
        <button
          type="button"
          title="Group selection (Ctrl+G)"
          aria-label="Group selection"
          disabled={!store.canGroup()}
          onClick={store.groupSel}
          class="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
        >
          <span class="iconify mdi--group size-4" />
        </button>
        <button
          type="button"
          title="Ungroup selection (Ctrl+Shift+G)"
          aria-label="Ungroup selection"
          disabled={!store.canUngroup()}
          onClick={store.ungroupSel}
          class="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
        >
          <span class="iconify mdi--ungroup size-4" />
        </button>
        <button
          type="button"
          title="Label group"
          aria-label="Label group"
          disabled={store.selectedGroup() === null}
          onClick={props.openGroupLabel}
          class="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
        >
          <span class="iconify mdi--tag-text-outline size-4" />
        </button>
      </div>

      <StylePanel store={store} />
    </>
  );
};
