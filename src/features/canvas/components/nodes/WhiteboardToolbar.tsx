import { For, type Component } from "solid-js";

import { cn } from "~/lib/utils";
import { canRedo, canUndo } from "./whiteboard/history";
import type { WhiteboardTool } from "./whiteboard/types";
import type { WhiteboardStore } from "./whiteboard/useWhiteboardStore";
import { StylePanel } from "./whiteboard/StylePanel";
import { WhiteboardFileRow } from "./WhiteboardFileRow";

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

/**
 * Reserved tool slots: frame/image/embed elements render, import, and
 * export — but have no draw tools yet (create them on excalidraw.com and
 * import, or paste them in). Disabled so the layout doesn't shift later.
 */
export const COMING_TOOLS: { id: string; icon: string; label: string }[] = [
  { id: "frame", icon: "mdi--frame", label: "Frame (Phase 4)" },
  { id: "image", icon: "mdi--image-outline", label: "Image (Phase 4)" },
  { id: "embed", icon: "mdi--web", label: "Embed (Phase 4)" },
];

/** Small icon button shared by the edit + canvas rows. */
const ToolButton: Component<{
  title: string; label: string; icon: string;
  pressed?: boolean; disabled?: boolean; onClick?: () => void;
}> = (props) => (
  <button
    type="button"
    title={props.title}
    aria-label={props.label}
    aria-pressed={props.pressed ?? false}
    disabled={props.disabled}
    onClick={props.onClick}
    class={cn(
      "rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30",
      props.pressed && "bg-primary/15 text-primary",
    )}
  >
    <span class={cn("iconify size-4", props.icon)} />
  </button>
);

/** Tool row + contextual Excalidraw-like style panel. */
export const WhiteboardToolbar: Component<{
  store: WhiteboardStore;
}> = (props) => {
  const { store } = props;

  const selIds = () => store.selectedIds();
  const selEls = () => {
    const set = new Set(selIds());
    return store.elements().filter((e) => set.has(e.id));
  };
  const allLocked = () => {
    const els = selEls();
    return els.length > 0 && els.every((e) => e.locked);
  };
  const selLink = () => {
    const els = selEls();
    for (const el of els) {
      if (el.link) return el.link;
    }
    return null;
  };

  const handleLink = () => {
    const current = selLink();
    if (current) {
      store.setLink(null);
      return;
    }
    if (typeof window === "undefined" || typeof window.prompt !== "function") return;
    const url = window.prompt("Link URL (empty clears):", "https://");
    if (url === null) return;
    const trimmed = url.trim();
    store.setLink(trimmed.length > 0 ? trimmed : null);
  };

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
        <For each={COMING_TOOLS}>
          {(t) => (
            <button
              type="button"
              title={t.label}
              aria-label={t.label}
              disabled
              class="rounded p-1.5 text-muted-foreground opacity-30"
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
        <div class="mx-1 h-4 w-px bg-border/60" />
        <ToolButton
          title="Duplicate selection (Ctrl+D, Alt-drag)"
          label="Duplicate selection"
          icon="mdi--content-duplicate"
          disabled={selIds().length === 0}
          onClick={() => store.duplicateSelected()}
        />
        <ToolButton
          title={allLocked() ? "Unlock selection" : "Lock selection"}
          label={allLocked() ? "Unlock selection" : "Lock selection"}
          icon={allLocked() ? "mdi--lock-outline" : "mdi--lock-open-outline"}
          pressed={allLocked()}
          disabled={selIds().length === 0}
          onClick={store.toggleLock}
        />
        <ToolButton
          title={selLink() ? `Edit link (${selLink()}) — click clears` : "Attach link"}
          label={selLink() ? "Edit link" : "Attach link"}
          icon="mdi--link-variant"
          pressed={selLink() !== null}
          disabled={selIds().length === 0}
          onClick={handleLink}
        />
        <div class="mx-1 h-4 w-px bg-border/60" />
        <ToolButton
          title="Bring forward"
          label="Bring forward"
          icon="mdi--arrange-bring-forward"
          disabled={selIds().length === 0}
          onClick={store.bringForward}
        />
        <ToolButton
          title="Send backward"
          label="Send backward"
          icon="mdi--arrange-send-backward"
          disabled={selIds().length === 0}
          onClick={store.sendBackward}
        />
        <ToolButton
          title="Bring to front"
          label="Bring to front"
          icon="mdi--arrange-bring-to-front"
          disabled={selIds().length === 0}
          onClick={store.bringToFront}
        />
        <ToolButton
          title="Send to back"
          label="Send to back"
          icon="mdi--arrange-send-to-back"
          disabled={selIds().length === 0}
          onClick={store.sendToBack}
        />
        <div class="mx-1 h-4 w-px bg-border/60" />
        {/* Canvas background + grid (writes appState-equivalent store state). */}
        <label
          class="flex items-center gap-1 rounded p-1.5 text-muted-foreground"
          title="Canvas background color"
        >
          <span class="iconify mdi--canvas size-4" />
          <input
            type="color"
            title="Canvas background color"
            aria-label="Canvas background color"
            value={store.viewBackgroundColor() === "transparent" ? "#000000" : store.viewBackgroundColor()}
            onInput={(e) => store.setViewBackgroundColor(e.currentTarget.value)}
            class="size-4 cursor-pointer rounded border border-border/60 bg-transparent p-0"
          />
        </label>
        <ToolButton
          title="Transparent canvas background"
          label="Transparent canvas background"
          icon="mdi--square-outline"
          pressed={store.viewBackgroundColor() === "transparent"}
          onClick={() => store.setViewBackgroundColor("transparent")}
        />
        <ToolButton
          title="Toggle grid"
          label="Toggle grid"
          icon="mdi--grid"
          pressed={store.gridSize() !== null}
          onClick={store.toggleGrid}
        />
      </div>

      <StylePanel store={store} />
      {/* Phase 4 file + clipboard interop (export .excalidraw/JSON/PNG/SVG, import picker). */}
      <WhiteboardFileRow store={store} />
    </>
  );
};
