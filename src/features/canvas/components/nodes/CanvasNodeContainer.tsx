import { Show, createEffect, createSignal, onCleanup, type JSX, type Component } from "solid-js";
import type { CanvasNodeDto, ProjectDto } from "~/types/dto";
import { snapToGrid } from "../../hooks/useCanvasTransform";
import { DEFAULT_NODE_SIZE, useMeasuredSizes } from "../../geometry/measuredSizes";
import { getNodeDef } from "../../nodes/registry";
import { cn } from "~/lib/utils";

export interface CanvasNodeComponentProps {
  node: CanvasNodeDto;
  project: () => ProjectDto;
  allNodes?: CanvasNodeDto[];
  isDraggable?: boolean;
  snapEnabled?: boolean;
  zoom?: number;
  resizable?: boolean;
  isFocused?: boolean;
  isFullscreen?: boolean;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onResize?: (id: string, width: number, height: number) => void;
  onDelete?: (id: string) => void;
  onPinToggle?: (id: string) => void;
  onStartDrag?: () => void;
  onFocusNode?: (id: string) => void;
  onToggleFullscreen?: (id: string) => void;
  onDataChange?: (id: string, dataJson: string | null) => void;
  onTitleChange?: (id: string, title: string) => void;
}

export interface CanvasNodeContainerProps {
  node: CanvasNodeDto;
  icon?: string;
  badge?: string;
  badgeVariant?: "nominal" | "amber" | "red";
  isDraggable?: boolean;
  snapEnabled?: boolean;
  zoom?: number;
  resizable?: boolean;
  isFocused?: boolean;
  isFullscreen?: boolean;
  /**
   * When false the node body clips instead of scrolling, so an embedded
   * scroller (e.g. the xterm viewport) is the only scrollable surface.
   * Defaults to true (legacy behavior for text-heavy nodes).
   */
  bodyScrollable?: boolean;
  children: JSX.Element;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onResize?: (id: string, width: number, height: number) => void;
  onDelete?: (id: string) => void;
  onPinToggle?: (id: string) => void;
  onStartDrag?: () => void;
  onFocusNode?: (id: string) => void;
  onToggleFullscreen?: (id: string) => void;
  onTitleChange?: (id: string, title: string) => void;
}

export const CanvasNodeContainer: Component<CanvasNodeContainerProps> = (props) => {
  const [minimized, setMinimized] = createSignal(false);
  const [isDragging, setIsDragging] = createSignal(false);
  const [isResizing, setIsResizing] = createSignal(false);
  const [editingTitle, setEditingTitle] = createSignal(false);
  const [titleDraft, setTitleDraft] = createSignal("");
  const [localPos, setLocalPos] = createSignal<{ x: number; y: number } | null>(null);
  const [localSize, setLocalSize] = createSignal<{ width: number; height: number } | null>(null);

  let startPointerX = 0;
  let startPointerY = 0;
  let initialNodeX = 0;
  let initialNodeY = 0;
  let initialNodeW = 0;
  let initialNodeH = 0;

  // rAF coalescing: the node itself follows the cursor synchronously via
  // localPos/localSize, while the global store (wires, minimap) syncs at most
  // once per frame so drag math never queues up behind pointer-event rate.
  let pendingPos: { x: number; y: number } | null = null;
  let posRaf = 0;
  let pendingSize: { width: number; height: number } | null = null;
  let sizeRaf = 0;

  const flushPos = () => {
    posRaf = 0;
    const p = pendingPos;
    pendingPos = null;
    if (p) props.onPositionChange?.(props.node.id, p.x, p.y);
  };

  const queuePos = (x: number, y: number) => {
    pendingPos = { x, y };
    if (!posRaf) posRaf = window.requestAnimationFrame(flushPos);
  };

  const flushSize = () => {
    sizeRaf = 0;
    const s = pendingSize;
    pendingSize = null;
    if (s) props.onResize?.(props.node.id, s.width, s.height);
  };

  const queueSize = (width: number, height: number) => {
    pendingSize = { width, height };
    if (!sizeRaf) sizeRaf = window.requestAnimationFrame(flushSize);
  };

  onCleanup(() => {
    if (posRaf) window.cancelAnimationFrame(posRaf);
    if (sizeRaf) window.cancelAnimationFrame(sizeRaf);
  });

  // Report the real rendered box so minimap/wires agree with the screen even
  // when it differs from DTO dimensions (minimized, auto-height content).
  const measured = useMeasuredSizes();
  let rootEl: HTMLDivElement | undefined;
  let headerEl: HTMLDivElement | undefined;

  createEffect(() => {
    const el = rootEl;
    if (!el) return;
    let raf = 0;
    let lastW = 0;
    let lastH = 0;
    const ro = new ResizeObserver(() => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        if (Math.abs(w - lastW) < 1 && Math.abs(h - lastH) < 1) return;
        lastW = w;
        lastH = h;
        measured.reportSize(props.node.id, w, h);
      });
    });
    ro.observe(el);
    onCleanup(() => {
      ro.disconnect();
      if (raf) window.cancelAnimationFrame(raf);
    });
  });

  // Report the measured header height so port rows anchor to the real
  // header bottom edge instead of a hardcoded offset.
  createEffect(() => {
    const el = headerEl;
    if (!el) return;
    let raf = 0;
    let lastH = 0;
    const report = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const h = el.offsetHeight;
        if (Math.abs(h - lastH) < 1) return;
        lastH = h;
        measured.reportHeaderHeight(props.node.id, h);
      });
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    onCleanup(() => {
      ro.disconnect();
      if (raf) window.cancelAnimationFrame(raf);
    });
  });

  const currentX = () => localPos()?.x ?? props.node.x;
  const currentY = () => localPos()?.y ?? props.node.y;

  const currentWidth = () => {
    if (effectiveMinimized()) return 240;
    return localSize()?.width ?? props.node.width ?? DEFAULT_NODE_SIZE.width;
  };

  const isResizable = () => props.resizable ?? true;

  // Registry-gated: only content-heavy nodes offer the fullscreen zoom.
  const canFullscreen = () =>
    getNodeDef(props.node.nodeType)?.capabilities?.allowFullscreen === true;

  // Fullscreen forces the body open (a minimized node still fills the canvas)
  // without losing its minimized flag — exit restores the prior state.
  const effectiveMinimized = () => minimized() && !props.isFullscreen;

  const currentHeight = () => {
    if (effectiveMinimized()) return undefined;
    // Fixed-content nodes size to their content instead of stretching
    // to a persisted height, so no dead space appears below the body.
    // Fullscreen is the exception: the node must honor the fullscreen
    // pixel height (e.g. git status tab) so it actually fills the canvas.
    if (!isResizable() && !props.isFullscreen) return undefined;
    const h = localSize()?.height ?? props.node.height;
    return h ? `${h}px` : undefined;
  };

  // Dragging handlers with window listeners
  const handlePointerDown = (e: PointerEvent) => {
    // Header presses stopPropagation below, so focus explicitly here — before
    // the pinned/button guards, since pressing a pinned node still focuses it.
    props.onFocusNode?.(props.node.id);
    if (e.button !== 0) return; // Left mouse click only
    if (props.isFullscreen) return; // Locked while fullscreen (focus only)
    if (props.node.isPinned) return;
    if (
      (e.target as HTMLElement).closest(
        "button, input, select, textarea, a, pre, code, canvas, [data-whiteboard-canvas], .shiki-container, .xterm, .xterm-screen, [data-xterm-container]",
      )
    )
      return;

    e.preventDefault();
    e.stopPropagation();

    props.onStartDrag?.();

    setIsDragging(true);
    startPointerX = e.clientX;
    startPointerY = e.clientY;
    initialNodeX = props.node.x;
    initialNodeY = props.node.y;

    const zoom = () => props.zoom || 1;

    const handleWindowPointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      const dx = (moveEvent.clientX - startPointerX) / zoom();
      const dy = (moveEvent.clientY - startPointerY) / zoom();
      const rawX = initialNodeX + dx;
      const rawY = initialNodeY + dy;
      const finalX = snapToGrid(rawX, props.snapEnabled);
      const finalY = snapToGrid(rawY, props.snapEnabled);

      // Synchronous: node stays under the cursor. Store sync is rAF-coalesced.
      setLocalPos({ x: finalX, y: finalY });
      queuePos(finalX, finalY);
    };

    const handleWindowPointerUp = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerUp);
      window.removeEventListener("pointercancel", handleWindowPointerUp);

      if (posRaf) {
        window.cancelAnimationFrame(posRaf);
        posRaf = 0;
      }
      pendingPos = null;

      const dx = (upEvent.clientX - startPointerX) / zoom();
      const dy = (upEvent.clientY - startPointerY) / zoom();
      const finalX = snapToGrid(initialNodeX + dx, props.snapEnabled);
      const finalY = snapToGrid(initialNodeY + dy, props.snapEnabled);

      setLocalPos(null);
      setIsDragging(false);
      props.onPositionChange?.(props.node.id, finalX, finalY);
    };

    window.addEventListener("pointermove", handleWindowPointerMove, { passive: false });
    window.addEventListener("pointerup", handleWindowPointerUp);
    window.addEventListener("pointercancel", handleWindowPointerUp);
  };

  // Resize handler with window listeners (no-op for fixed-content nodes)
  const handleResizeStart = (e: PointerEvent) => {
    props.onFocusNode?.(props.node.id);
    if (!isResizable()) return;
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    setIsResizing(true);
    startPointerX = e.clientX;
    startPointerY = e.clientY;
    initialNodeW = props.node.width || DEFAULT_NODE_SIZE.width;
    initialNodeH = props.node.height || DEFAULT_NODE_SIZE.height;

    const zoom = () => props.zoom || 1;

    const handleWindowResizeMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      const dx = (moveEvent.clientX - startPointerX) / zoom();
      const dy = (moveEvent.clientY - startPointerY) / zoom();
      const rawW = Math.max(240, initialNodeW + dx);
      const rawH = Math.max(140, initialNodeH + dy);
      const finalW = snapToGrid(rawW, props.snapEnabled);
      const finalH = snapToGrid(rawH, props.snapEnabled);

      setLocalSize({ width: finalW, height: finalH });
      queueSize(finalW, finalH);
    };

    const handleWindowResizeUp = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", handleWindowResizeMove);
      window.removeEventListener("pointerup", handleWindowResizeUp);
      window.removeEventListener("pointercancel", handleWindowResizeUp);

      if (sizeRaf) {
        window.cancelAnimationFrame(sizeRaf);
        sizeRaf = 0;
      }
      pendingSize = null;

      const dx = (upEvent.clientX - startPointerX) / zoom();
      const dy = (upEvent.clientY - startPointerY) / zoom();
      const rawW = Math.max(240, initialNodeW + dx);
      const rawH = Math.max(140, initialNodeH + dy);
      const finalW = snapToGrid(rawW, props.snapEnabled);
      const finalH = snapToGrid(rawH, props.snapEnabled);

      setLocalSize(null);
      setIsResizing(false);
      props.onResize?.(props.node.id, finalW, finalH);
    };

    window.addEventListener("pointermove", handleWindowResizeMove, { passive: false });
    window.addEventListener("pointerup", handleWindowResizeUp);
    window.addEventListener("pointercancel", handleWindowResizeUp);
  };

  const resolvedNodeIcon = () => {
    let icon = props.icon;
    if (!icon) {
      switch (props.node.nodeType) {
        case "git":
          icon = "mdi--git";
          break;
        case "task":
          icon = "mdi--play-circle-outline";
          break;
        case "taskStep":
          icon = "mdi--play-box-outline";
          break;
        case "github-actions":
          icon = "mdi--github";
          break;
        case "dokploy":
          icon = "mdi--cloud-upload-outline";
          break;
        case "terminal":
          icon = "mdi--console";
          break;
        case "filePreview":
          icon = "mdi--file-code-outline";
          break;
        case "webPreview":
          icon = "mdi--web";
          break;
        case "webTools":
          icon = "mdi--tools";
          break;
        case "notes":
          icon = "mdi--notebook-outline";
          break;
        case "zettel":
          icon = "mdi--card-text-outline";
          break;
        case "whiteboard":
          icon = "mdi--draw";
          break;
        default:
          icon = "mdi--application-outline";
          break;
      }
    }
    if (icon.startsWith("i-mdi-")) {
      return `mdi--${icon.slice(6)}`;
    }
    return icon;
  };

  const startTitleEdit = () => {
    if (!props.onTitleChange) return;
    setTitleDraft(props.node.title);
    setEditingTitle(true);
  };

  const commitTitleEdit = () => {
    if (!editingTitle()) return;
    setEditingTitle(false);
    const next = titleDraft().trim().slice(0, 80);
    if (next && next !== props.node.title) {
      props.onTitleChange?.(props.node.id, next);
    }
  };

  const cancelTitleEdit = () => {
    setEditingTitle(false);
  };

  const getZIndex = () => {
    if (props.isFocused === true) return 30;
    if (isDragging() || isResizing()) return 25;
    if (props.node.isPinned) return 5;
    return 2;
  };

  return (
    <div
      ref={(el) => (rootEl = el)}
      data-canvas-node-id={props.node.id}
      // Any press inside the node focuses it (bubble; drag/resize starters
      // stopPropagation, so they focus explicitly in their handlers).
      onPointerDown={() => props.onFocusNode?.(props.node.id)}
      class="absolute flex flex-col rounded-xl border border-border/70 text-card-foreground shadow-lg transition-shadow hover:shadow-xl hover:border-border"
      classList={{
        // Frosted glass at rest; solid + promoted layer while moving so the
        // drag doesn't pay a backdrop-blur repaint every frame.
        "bg-card/90 backdrop-blur-md": !isDragging() && !isResizing(),
        "bg-card will-change-transform": isDragging() || isResizing(),
        // Focused node paints above everything (incl. pinned/dragging) and
        // gets a ring so the frontmost node is identifiable.
        "ring-1 ring-primary/60": props.isFocused,
      }}
      style={{
        transform: `translate3d(${currentX()}px, ${currentY()}px, 0)`,
        width: `${currentWidth()}px`,
        height: currentHeight(),
        "z-index": getZIndex(),
      }}
    >
      {/* Draggable Header */}
      <div
        ref={(el) => (headerEl = el)}
        onPointerDown={handlePointerDown}
        class="flex select-none items-center justify-between border-b border-border/40 px-3 py-2 text-xs font-semibold"
        classList={{
          "cursor-grab": !props.node.isPinned && !isDragging(),
          "cursor-grabbing": isDragging(),
        }}
      >
        <div class="flex min-w-0 flex-1 items-center gap-2 truncate">
          <Show when={resolvedNodeIcon()}>
            {(iconClass) => (
              <span class={cn("iconify size-4 text-primary shrink-0 inline-block", iconClass())} />
            )}
          </Show>
          <Show
            when={editingTitle()}
            fallback={
              <span
                class="truncate font-medium tracking-wide"
                title="Double-click to rename"
                onDblClick={(e) => {
                  e.stopPropagation();
                  startTitleEdit();
                }}
              >
                {props.node.title}
              </span>
            }
          >
            <input
              ref={(el) => {
                el.focus();
                el.select();
              }}
              value={titleDraft()}
              maxLength={80}
              onInput={(e) => setTitleDraft(e.currentTarget.value)}
              onBlur={commitTitleEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                else if (e.key === "Escape") cancelTitleEdit();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onDblClick={(e) => e.stopPropagation()}
              class="min-w-0 flex-1 truncate rounded border border-primary/50 bg-background px-1 py-0.5 font-medium tracking-wide focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </Show>
        </div>

        <div class="flex items-center gap-1 shrink-0">
          <Show when={props.badge}>
            <span
              class="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider"
              classList={{
                "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30":
                  props.badgeVariant === "nominal",
                "bg-amber-500/15 text-amber-400 border border-amber-500/30":
                  props.badgeVariant === "amber",
                "bg-rose-500/15 text-rose-400 border border-rose-500/30":
                  props.badgeVariant === "red",
                "bg-muted text-muted-foreground": !props.badgeVariant,
              }}
            >
              {props.badge}
            </span>
          </Show>

          {/* Fullscreen Toggle (camera zoom so the node fills the canvas).
              Hidden when no handler is wired — a dead button is worse than none. */}
          <Show when={canFullscreen() && props.onToggleFullscreen}>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                props.onToggleFullscreen?.(props.node.id);
              }}
              title={props.isFullscreen ? "Exit fullscreen" : "Fullscreen (fill canvas)"}
              class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              classList={{ "text-primary": props.isFullscreen }}
            >
              <span
                class="iconify size-3.5"
                classList={{
                  "mdi--fullscreen-exit": props.isFullscreen,
                  "mdi--fullscreen": !props.isFullscreen,
                }}
              />
            </button>
          </Show>

          {/* Minimize / Restore Toggle */}
          <button
            type="button"
            onClick={() => setMinimized(!minimized())}
            title={minimized() ? "Restore node" : "Minimize node"}
            class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <span
              class="iconify size-3.5"
              classList={{
                "mdi--window-maximize": minimized(),
                "mdi--window-minimize": !minimized(),
              }}
            />
          </button>

          {/* Pin Toggle */}
          <button
            type="button"
            onClick={() => props.onPinToggle?.(props.node.id)}
            title={props.node.isPinned ? "Unpin node" : "Pin node"}
            class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <span
              class="iconify size-3.5"
              classList={{
                "mdi--pin text-primary": !!props.node.isPinned,
                "mdi--pin-outline": !props.node.isPinned,
              }}
            />
          </button>

          {/* Delete Button */}
          <button
            type="button"
            onClick={() => props.onDelete?.(props.node.id)}
            title="Remove node"
            class="rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive transition-colors"
          >
            <span class="iconify mdi--close size-3.5" />
          </button>
        </div>
      </div>

      {/* Node Body (hidden when minimized — fullscreen forces it open) */}
      <Show when={!effectiveMinimized()}>
        <div
          class="flex min-h-0 flex-1 flex-col p-3 text-xs"
          classList={{
            "overflow-auto": props.bodyScrollable !== false,
            "overflow-hidden": props.bodyScrollable === false,
          }}
        >
          {props.children}
        </div>

        {/* Resizable Corner Handle (locked while fullscreen) */}
        <Show when={isResizable() && !props.isFullscreen}>
          <div
            onPointerDown={handleResizeStart}
            class="absolute bottom-1 right-1 h-4 w-4 cursor-se-resize select-none text-muted-foreground/30 hover:text-primary transition-colors flex items-end justify-end p-0.5"
            title="Drag to resize node"
          >
            <span class="iconify mdi--resize-bottom-right size-3.5" />
          </div>
        </Show>
      </Show>
    </div>
  );
};
