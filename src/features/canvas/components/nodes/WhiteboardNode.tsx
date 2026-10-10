import { Show, type Component } from "solid-js";
import { CanvasNodeContainer, type CanvasNodeComponentProps } from "./CanvasNodeContainer";
import { cn } from "~/lib/utils";
import { useWhiteboardStore } from "./whiteboard/useWhiteboardStore";
import { useWhiteboardPointer } from "./whiteboard/useWhiteboardPointer";
import { useWhiteboardLabels } from "./whiteboard/useWhiteboardLabels";
import { WhiteboardToolbar, TOOL_SHORTCUTS } from "./WhiteboardToolbar";
import { WhiteboardOverlays } from "./WhiteboardOverlays";

/**
 * Whiteboard canvas node shell: composes store + pointer + labels +
 * toolbar + overlays. (Logic extracted to whiteboard/*.)
 */
export const WhiteboardNode: Component<CanvasNodeComponentProps> = (props) => {
  const store = useWhiteboardStore({ node: props.node, onDataChange: props.onDataChange });
  const labels = useWhiteboardLabels({
    store,
    toLocal: (e) => pointer.toLocal(e),
    hasCanvas: () => pointer.hasCanvas(),
  });
  const pointer = useWhiteboardPointer({
    store,
    nodeId: props.node.id,
    onFocusNode: props.onFocusNode,
    onTextTool: (pt, width, containerId, textId) =>
      labels.beginTextAt(pt, width ?? null, containerId ?? null, textId ?? null),
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    // Text overlay handles its own keys.
    if (labels.labelEdit()) return;
    const tag = (document.activeElement?.tagName ?? "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    // Space+drag pans the board (canvas-like); ignore repeats.
    if (e.key === " " && !e.repeat && !e.ctrlKey && !e.metaKey) {
      e.stopPropagation();
      e.preventDefault();
      store.setSpacePan(true);
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.stopPropagation();
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === "y") {
      e.stopPropagation();
      e.preventDefault();
      store.redo();
      return;
    }
    if (mod && e.key.toLowerCase() === "g") {
      e.stopPropagation();
      e.preventDefault();
      if (e.shiftKey) store.ungroupSel();
      else store.groupSel();
      return;
    }
    // Excalidraw editing map (Phase 3): Ctrl+D duplicates the selection.
    if (mod && e.key.toLowerCase() === "d") {
      e.stopPropagation();
      e.preventDefault();
      store.duplicateSelected();
      return;
    }
    // Arrow-key nudge: 1px, 10px with Shift (Excalidraw parity).
    if (!mod && store.selectedIds().length > 0) {
      const step = e.shiftKey ? 10 : 1;
      let dir: { x: number; y: number } | null = null;
      if (e.key === "ArrowLeft") dir = { x: -step, y: 0 };
      if (e.key === "ArrowRight") dir = { x: step, y: 0 };
      if (e.key === "ArrowUp") dir = { x: 0, y: -step };
      if (e.key === "ArrowDown") dir = { x: 0, y: step };
      if (dir) {
        e.stopPropagation();
        e.preventDefault();
        store.nudgeSelected(dir.x, dir.y);
        return;
      }
    }
    if ((e.key === "Delete" || e.key === "Backspace") && store.selectedIds().length > 0) {
      e.stopPropagation();
      store.deleteSelected();
      return;
    }
    if (e.key === "Escape") {
      e.stopPropagation();
      store.setSelectedIds([]);
      pointer.cancelGesture();
      store.setTool("select");
      return;
    }
    if (!mod) {
      const t = TOOL_SHORTCUTS[e.key.toLowerCase()];
      if (t) {
        e.stopPropagation();
        store.setTool(t);
        return;
      }
      if (e.key === "0") {
        e.stopPropagation();
        store.resetView();
        return;
      }
      if (e.shiftKey && (e.key === "!" || e.key === "1")) {
        // Shift+1 fits the board content (matches outer canvas shortcut).
        e.stopPropagation();
        if (boardWrap) {
          const rect = boardWrap.getBoundingClientRect();
          store.fitView(Math.max(1, Math.floor(rect.width)), Math.max(1, Math.floor(rect.height)));
        }
      }
    }
  };

  const handleKeyUp = (e: KeyboardEvent) => {
    if (e.key === " ") store.setSpacePan(false);
  };

  let boardWrap: HTMLDivElement | undefined;

  /** Phase 4 import: paste excalidraw.com JSON / drop .excalidraw files. */
  const looksLikeScene = (t: string): boolean => {
    const s = t.trimStart();
    return s.startsWith("{") || s.startsWith("[");
  };

  const handlePaste = (e: ClipboardEvent) => {
    // Text overlay owns its own paste.
    if (labels.labelEdit()) return;
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (!looksLikeScene(text)) return;
    const { added } = store.importText(text);
    if (added > 0) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const handleDrop = (e: DragEvent) => {
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const file = files[0];
    if (file.type.startsWith("image/")) {
      store.setInteropNotice("Image drops aren't supported — import .excalidraw files for now");
      return;
    }
    void file
      .text()
      .then((text) => {
        store.importText(text);
      })
      .catch(() => {
        store.setInteropNotice("Import failed — unreadable file");
      });
  };

  /** Canvas paint (Phase 3 appState parity): bg color + dotted grid overlay. */
  const boardStyle = (): Record<string, string> => {    const style: Record<string, string> = { "min-height": "280px" };
    const bg = store.viewBackgroundColor();
    if (bg !== "transparent") style["background-color"] = bg;
    const grid = store.gridSize();
    if (grid !== null && grid > 0) {
      style["background-image"] = "radial-gradient(circle, rgba(148, 163, 184, 0.35) 1px, transparent 1px)";
      style["background-size"] = `${grid}px ${grid}px`;
    }
    return style;
  };

  return (
    <CanvasNodeContainer
      node={props.node}
      icon="mdi--draw"
      badge="Whiteboard"
      isDraggable={props.isDraggable}
      snapEnabled={props.snapEnabled}
      zoom={props.zoom}
      resizable
      isFocused={props.isFocused}
      isFullscreen={props.isFullscreen}
      onPositionChange={props.onPositionChange}
      onResize={props.onResize}
      onDelete={props.onDelete}
      onPinToggle={props.onPinToggle}
      onFocusNode={props.onFocusNode}
      onToggleFullscreen={props.onToggleFullscreen}
      onTitleChange={props.onTitleChange}
      onStartDrag={props.onStartDrag}
    >
      <WhiteboardToolbar store={store} />

      {/* Board */}
      <div
        ref={(el) => {
          boardWrap = el;
          pointer.setWrapRef(el);
        }}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onWheel={pointer.handleWheel}
        onPaste={handlePaste}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        class={cn(
          "relative min-h-60 w-full flex-1 overflow-hidden rounded border border-border/40 bg-background/50 focus:outline-none focus:ring-1 focus:ring-primary/50",
          store.cursor(),
        )}
        // Inline fallback so the board keeps a paintable area even if the
        // utility class ever fails to generate.
        style={boardStyle()}
      >
        <canvas
          ref={(el) => pointer.setCanvasRef(el)}
          data-whiteboard-canvas
          class="absolute inset-0 h-full w-full touch-none"
          onPointerDown={pointer.handlePointerDown}
          onPointerMove={pointer.handlePointerMove}
          onPointerUp={pointer.handlePointerUp}
          onDblClick={labels.handleDoubleClick}
          onPointerCancel={() => pointer.cancelGesture()}
        />
        <WhiteboardOverlays labels={labels} store={store} />
      </div>

      <div class="flex items-center justify-between pt-1.5 text-[10px] text-muted-foreground/70">
        <span>
          {store.count()} {store.count() === 1 ? "element" : "elements"}
          <Show when={store.selCount() > 0}>
            {" "}
            — {store.selCount()} selected (Delete removes, Ctrl+G groups)
          </Show>
        </span>
        <span class="flex items-center gap-1">
          <span class="mr-1 hidden xl:inline">
            Space-drag / middle-drag pans — wheel zooms — double-click a shape for text
          </span>
          <button
            type="button"
            title="Zoom out"
            aria-label="Zoom out"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              store.zoomOut();
            }}
            class="rounded px-1 py-0.5 transition-colors hover:bg-muted hover:text-foreground"
          >
            −
          </button>
          <button
            type="button"
            title="Reset view (0)"
            aria-label="Reset view"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              store.resetView();
            }}
            class="min-w-9 rounded px-1 py-0.5 text-center tabular-nums transition-colors hover:bg-muted hover:text-foreground"
          >
            {Math.round(store.zoom() * 100)}%
          </button>
          <button
            type="button"
            title="Zoom in"
            aria-label="Zoom in"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              store.zoomIn();
            }}
            class="rounded px-1 py-0.5 transition-colors hover:bg-muted hover:text-foreground"
          >
            +
          </button>
          <button
            type="button"
            title="Fit content (Shift+1)"
            aria-label="Fit content"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (boardWrap) {
                const rect = boardWrap.getBoundingClientRect();
                store.fitView(
                  Math.max(1, Math.floor(rect.width)),
                  Math.max(1, Math.floor(rect.height)),
                );
              }
            }}
            class="rounded px-1 py-0.5 transition-colors hover:bg-muted hover:text-foreground"
          >
            <span class="iconify mdi--fit-to-screen size-3" />
          </button>
        </span>
      </div>
    </CanvasNodeContainer>
  );
};
