import { render } from "solid-js/web";
import { createSignal, onMount, onCleanup, Show, createMemo, For } from "solid-js";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  type Annotation,
  type AnnotationTool,
  generateId,
  renderAll,
  drawAnnotation,
  hitTest,
  moveAnnotation,
  drawSelectionIndicator,
  type ResizeHandle,
  hitTestHandle,
  resizeAnnotation,
} from "~/features/screenshot/lib/canvas-tools";
import "./App.css";

// --- Types ---

type OverlayMode = "idle" | "selecting" | "selected" | "annotate";
type HandlePos = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// --- Constants ---

const MIN_SIZE = 50;
const HANDLE_SIZE = 10;
const HANDLE_CURSORS: Record<HandlePos, string> = {
  nw: "nwse-resize", n: "ns-resize", ne: "nesw-resize", e: "ew-resize",
  se: "nwse-resize", s: "ns-resize", sw: "nesw-resize", w: "ew-resize",
};

const BRUSH_TOOLS: ReadonlySet<AnnotationTool> = new Set(["freehand", "highlight"]);

// --- Component ---

function ScreenshotOverlay() {
  // eslint-disable-next-line no-unassigned-vars — Solid ref pattern
  let canvasRef: HTMLCanvasElement | undefined;
  // eslint-disable-next-line no-unassigned-vars — Solid ref pattern
  let annotCanvasRef: HTMLCanvasElement | undefined;

  // eslint-disable-next-line no-unassigned-vars — Solid ref pattern
  let imageRef: HTMLImageElement | undefined;
  const [strings, setStrings] = createSignal<Record<string, string>>({});
  // Image dimensions in physical pixels (set when image loads)
  const [imgDims, setImgDims] = createSignal({ w: 0, h: 0 });

  // Selection state
  const [mode, setMode] = createSignal<OverlayMode>("idle");
  const [sel, setSel] = createSignal<Rect | null>(null);

  // Interaction
  const [mousePos, setMousePos] = createSignal<{ x: number; y: number } | null>(null);
  let dragMode: { type: "create"; startX: number; startY: number } | { type: "move"; offsetX: number; offsetY: number } | { type: "resize"; handle: HandlePos; origRect: Rect; startX: number; startY: number } | null = null;

  // Annotation state
  const [tool, setTool] = createSignal<AnnotationTool>("arrow");
  const [color, setColor] = createSignal("#ef4444");
  const [strokeWidth, setStrokeWidth] = createSignal(3);
  const [annotations, setAnnotations] = createSignal<Annotation[]>([]);
  const [undoStack, setUndoStack] = createSignal<Annotation[][]>([]);
  const [isDrawing, setIsDrawing] = createSignal(false);
  let currentAnnotation: Annotation | null = null;
  const [selectedAnnotationId, setSelectedAnnotationId] = createSignal<string | null>(null);
  const [isDraggingAnnotation, setIsDraggingAnnotation] = createSignal(false);
  let dragStartPt: { x: number; y: number } | null = null;
  const [activeResizeHandle, setActiveResizeHandle] = createSignal<ResizeHandle | null>(null);
  const [hoveredHandleCursor, setHoveredHandleCursor] = createSignal<string | null>(null);

  const str = (key: string) => strings()[key] ?? key;

  // --- Canvas helpers ---

  function resizeCanvasToWindow() {
    if (!canvasRef || !imageRef) return;
    // CSS display = window dimensions (logical pixels)
    canvasRef.style.width = `${window.innerWidth}px`;
    canvasRef.style.height = `${window.innerHeight}px`;
  }

  function redrawCanvas() {
    if (!canvasRef || !imageRef) return;
    const ctx = canvasRef.getContext("2d");
    if (!ctx) return;
    const dims = imgDims();
    ctx.clearRect(0, 0, canvasRef.width, canvasRef.height);
    ctx.drawImage(imageRef, 0, 0, dims.w, dims.h);
  }

  // --- Mouse handling ---

  function handleMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    const mx = e.clientX;
    const my = e.clientY;

    if (mode() === "annotate") {
      annotateDown(e);
      return;
    }

    // Check resize handle
    const handle = hitHandle(mx, my);
    if (handle && sel()) {
      dragMode = { type: "resize", handle, origRect: { ...sel()! }, startX: mx, startY: my };
      setMode("selecting");
      return;
    }

    // Check selection body
    const r = sel();
    if (r && mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
      dragMode = { type: "move", offsetX: mx - r.x, offsetY: my - r.y };
      setMode("selecting");
      return;
    }

    // New selection
    dragMode = { type: "create", startX: mx, startY: my };
    setSel({ x: mx, y: my, w: 0, h: 0 });
    setMode("selecting");
  }

  function handleMouseMove(e: MouseEvent) {
    const mx = e.clientX;
    const my = e.clientY;
    setMousePos({ x: mx, y: my });

    if (mode() === "annotate") {
      annotateMove(e);
      return;
    }

    if (mode() !== "selecting" || !dragMode) return;

    if (dragMode.type === "create") {
      const x = Math.min(dragMode.startX, mx);
      const y = Math.min(dragMode.startY, my);
      const w = Math.abs(mx - dragMode.startX);
      const h = Math.abs(my - dragMode.startY);
      setSel({ x, y, w, h });
      return;
    }

    if (dragMode.type === "move") {
      const ox = dragMode.offsetX;
      const oy = dragMode.offsetY;
      setSel((prev) => prev ? { ...prev, x: mx - ox, y: my - oy } : null);
      return;
    }

    if (dragMode.type === "resize") {
      const dx = mx - dragMode.startX;
      const dy = my - dragMode.startY;
      setSel(applyResize(dragMode.origRect, dragMode.handle, dx, dy));
    }
  }

  function handleMouseUp() {
    if (mode() === "annotate") {
      annotateUp();
      return;
    }

    if (mode() !== "selecting") return;
    dragMode = null;

    const r = sel();
    if (!r || r.w < MIN_SIZE || r.h < MIN_SIZE) {
      setSel(null);
      setMode("idle");
      return;
    }
    setSel({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });
    setMode("selected");
  }

  function hitHandle(mx: number, my: number): HandlePos | null {
    const r = sel();
    if (!r) return null;
    const hs = HANDLE_SIZE;
    const handles: [HandlePos, number, number][] = [
      ["nw", r.x, r.y], ["n", r.x + r.w / 2, r.y], ["ne", r.x + r.w, r.y],
      ["e", r.x + r.w, r.y + r.h / 2], ["se", r.x + r.w, r.y + r.h],
      ["s", r.x + r.w / 2, r.y + r.h], ["sw", r.x, r.y + r.h], ["w", r.x, r.y + r.h / 2],
    ];
    for (const [pos, hx, hy] of handles) {
      if (mx >= hx - hs && mx <= hx + hs && my >= hy - hs && my <= hy + hs) return pos;
    }
    return null;
  }

  function applyResize(orig: Rect, handle: HandlePos, dx: number, dy: number): Rect {
    let { x, y, w, h } = { ...orig };
    if (handle.includes("w")) { x += dx; w -= dx; }
    if (handle.includes("e")) { w += dx; }
    if (handle.includes("n")) { y += dy; h -= dy; }
    if (handle.includes("s")) { h += dy; }
    if (w < MIN_SIZE) { if (handle.includes("w")) x = orig.x + orig.w - MIN_SIZE; w = MIN_SIZE; }
    if (h < MIN_SIZE) { if (handle.includes("n")) y = orig.y + orig.h - MIN_SIZE; h = MIN_SIZE; }
    return { x, y, w, h };
  }

  // --- Annotate ---

  /** Convert CSS (mouse) coordinates to image (physical) coordinates */
  function cssToImage(r: Rect): Rect {
    if (!canvasRef) return r;
    const scaleX = canvasRef.width / canvasRef.clientWidth;
    const scaleY = canvasRef.height / canvasRef.clientHeight;
    return {
      x: r.x * scaleX,
      y: r.y * scaleY,
      w: r.w * scaleX,
      h: r.h * scaleY,
    };
  }

  function startAnnotate() {
    const r = sel();
    if (!r || !imageRef || !canvasRef) return;

    // Convert CSS coordinates to image coordinates
    const imgRect = cssToImage(r);

    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = imgRect.w;
    cropCanvas.height = imgRect.h;
    const cropCtx = cropCanvas.getContext("2d");
    if (!cropCtx) return;
    cropCtx.drawImage(imageRef, imgRect.x, imgRect.y, imgRect.w, imgRect.h, 0, 0, cropCanvas.width, cropCanvas.height);

    const croppedImg = new Image();
    croppedImg.onload = () => {
      imageRef = croppedImg;
      setAnnotations([]);
      setUndoStack([]);
      setMode("annotate");

      if (annotCanvasRef) {
        annotCanvasRef.width = r.w;
        annotCanvasRef.height = r.h;
        const ctx = annotCanvasRef.getContext("2d");
        if (ctx) ctx.drawImage(croppedImg, 0, 0, r.w, r.h);
      }
    };
    croppedImg.src = cropCanvas.toDataURL("image/png");
  }

  function annotateDown(e: MouseEvent) {
    if (!annotCanvasRef) return;
    const rect = annotCanvasRef.getBoundingClientRect();
    const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    if (tool() === "select") {
      const selId = selectedAnnotationId();
      if (selId) {
        const selectedAnn = annotations().find((a) => a.id === selId);
        if (selectedAnn) {
          const handle = hitTestHandle(selectedAnn, pt);
          if (handle) {
            setActiveResizeHandle(handle);
            setUndoStack((prev) => [...prev, [...annotations()]]);
            return;
          }
        }
      }

      const clicked = [...annotations()].reverse().find((ann) => hitTest(ann, pt));
      if (clicked) {
        setSelectedAnnotationId(clicked.id);
        setIsDraggingAnnotation(true);
        dragStartPt = pt;
        setUndoStack((prev) => [...prev, [...annotations()]]);
      } else {
        setSelectedAnnotationId(null);
      }
      redrawAnnot();
      return;
    }

    setIsDrawing(true);
    setUndoStack((prev) => [...prev, [...annotations()]]);
    const id = generateId();
    const base = { id, color: color(), strokeWidth: strokeWidth() };
    if (tool() === "arrow") currentAnnotation = { ...base, tool: "arrow", start: pt, end: pt };
    else if (tool() === "rectangle") currentAnnotation = { ...base, tool: "rectangle", start: pt, end: pt };
    else if (tool() === "freehand") currentAnnotation = { ...base, tool: "freehand", points: [pt] };
    else if (tool() === "highlight") currentAnnotation = { ...base, tool: "highlight", points: [pt] };
  }

  function annotateMove(e: MouseEvent) {
    if (!annotCanvasRef) return;
    const rect = annotCanvasRef.getBoundingClientRect();
    const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    if (tool() === "select") {
      if (activeResizeHandle() && selectedAnnotationId()) {
        setAnnotations((prev) =>
          prev.map((ann) =>
            ann.id === selectedAnnotationId()
              ? resizeAnnotation(ann, activeResizeHandle()!.id, pt)
              : ann
          )
        );
        redrawAnnot();
        return;
      }

      if (isDraggingAnnotation() && selectedAnnotationId() && dragStartPt) {
        const dx = pt.x - dragStartPt.x;
        const dy = pt.y - dragStartPt.y;
        if (dx !== 0 || dy !== 0) {
          setAnnotations((prev) =>
            prev.map((ann) =>
              ann.id === selectedAnnotationId() ? moveAnnotation(ann, dx, dy) : ann
            )
          );
          dragStartPt = pt;
          redrawAnnot();
        }
        return;
      }

      const selId = selectedAnnotationId();
      if (selId && !activeResizeHandle()) {
        const selectedAnn = annotations().find((a) => a.id === selId);
        if (selectedAnn) {
          const handle = hitTestHandle(selectedAnn, pt);
          if (handle) {
            setHoveredHandleCursor(handle.cursor);
          } else {
            setHoveredHandleCursor(null);
          }
        } else {
          setHoveredHandleCursor(null);
        }
      } else {
        setHoveredHandleCursor(null);
      }
      return;
    }

    if (!isDrawing() || !currentAnnotation) return;
    if (currentAnnotation.tool === "arrow" || currentAnnotation.tool === "rectangle") currentAnnotation.end = pt;
    else if (currentAnnotation.tool === "freehand" || currentAnnotation.tool === "highlight") currentAnnotation.points.push(pt);
    redrawAnnotLive();
  }

  function annotateUp() {
    if (tool() === "select") {
      setIsDraggingAnnotation(false);
      setActiveResizeHandle(null);
      return;
    }

    if (!isDrawing() || !currentAnnotation) return;
    setIsDrawing(false);
    setAnnotations((prev) => [...prev, currentAnnotation!]);
    currentAnnotation = null;
    redrawAnnot();
  }

  function redrawAnnot() {
    if (!annotCanvasRef || !imageRef) return;
    const ctx = annotCanvasRef.getContext("2d");
    if (!ctx) return;
    renderAll(ctx, imageRef, annotations());
    const selId = selectedAnnotationId();
    if (selId && tool() === "select") {
      const selectedAnn = annotations().find((a) => a.id === selId);
      if (selectedAnn) {
        drawSelectionIndicator(ctx, selectedAnn);
      }
    }
  }

  function redrawAnnotLive() {
    if (!annotCanvasRef || !imageRef) return;
    const ctx = annotCanvasRef.getContext("2d");
    if (!ctx) return;
    renderAll(ctx, imageRef, annotations());
    if (currentAnnotation) drawAnnotation(ctx, currentAnnotation);
    const selId = selectedAnnotationId();
    if (selId && tool() === "select") {
      const selectedAnn = annotations().find((a) => a.id === selId);
      if (selectedAnn) {
        drawSelectionIndicator(ctx, selectedAnn);
      }
    }
  }

  function undoAnnot() {
    const stack = undoStack();
    if (stack.length === 0) return;
    setUndoStack((s) => s.slice(0, -1));
    setAnnotations(stack[stack.length - 1]);
    redrawAnnot();
  }

  // --- Actions ---

  async function handleCancel() {
    await emitTo("main", "screenshot-overlay:cancel");
    await getCurrentWindow().close();
  }

  async function handleCopy() {
    if (mode() === "annotate" && annotCanvasRef) {
      const b64 = annotCanvasRef.toDataURL("image/png").split(",")[1];
      if (b64) { await emitTo("main", "screenshot-overlay:copy", { base64: b64 }); await getCurrentWindow().close(); }
      return;
    }
    const r = sel();
    if (!r || !canvasRef) return;
    const imgRect = cssToImage(r);
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = imgRect.w;
    cropCanvas.height = imgRect.h;
    const cropCtx = cropCanvas.getContext("2d");
    if (!cropCtx) return;
    cropCtx.drawImage(canvasRef, imgRect.x, imgRect.y, imgRect.w, imgRect.h, 0, 0, imgRect.w, imgRect.h);
    const b64 = cropCanvas.toDataURL("image/png").split(",")[1];
    if (b64) { await emitTo("main", "screenshot-overlay:copy", { base64: b64 }); await getCurrentWindow().close(); }
  }

  async function handleSave() {
    if (mode() === "annotate" && annotCanvasRef) {
      const b64 = annotCanvasRef.toDataURL("image/png").split(",")[1];
      if (b64) { await emitTo("main", "screenshot-overlay:result", { base64: b64 }); await getCurrentWindow().close(); }
      return;
    }
    // Crop selection from canvas using image coordinates
    const r = sel();
    if (!r || !canvasRef) return;
    const imgRect = cssToImage(r);
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = imgRect.w;
    cropCanvas.height = imgRect.h;
    const cropCtx = cropCanvas.getContext("2d");
    if (!cropCtx) return;
    cropCtx.drawImage(canvasRef, imgRect.x, imgRect.y, imgRect.w, imgRect.h, 0, 0, imgRect.w, imgRect.h);
    const b64 = cropCanvas.toDataURL("image/png").split(",")[1];
    if (b64) { await emitTo("main", "screenshot-overlay:result", { base64: b64 }); await getCurrentWindow().close(); }
  }

  // --- Keyboard ---

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") { void handleCancel(); return; }
    if (selectedAnnotationId() && tool() === "select" && mode() === "annotate" && (e.key === "Delete" || e.key === "Backspace")) {
      e.preventDefault();
      setUndoStack((prev) => [...prev, [...annotations()]]);
      setAnnotations((prev) => prev.filter((a) => a.id !== selectedAnnotationId()));
      setSelectedAnnotationId(null);
      redrawAnnot();
      return;
    }
    if (e.ctrlKey && e.key === "z" && !e.shiftKey && mode() === "annotate") { e.preventDefault(); undoAnnot(); }
    if (e.ctrlKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void handleSave();
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === "c") {
      e.preventDefault();
      void handleCopy();
      return;
    }
  }

  // --- Cursor ---

  const cursorStyle = createMemo(() => {
    if (mode() === "annotate") {
      return tool() === "select"
        ? (hoveredHandleCursor() || (activeResizeHandle() ? activeResizeHandle()!.cursor : "default"))
        : "none";
    }
    const mp = mousePos();
    if (mp) {
      if (hitHandle(mp.x, mp.y)) return HANDLE_CURSORS[hitHandle(mp.x, mp.y)!];
      const r = sel();
      if (r && mp.x >= r.x && mp.x <= r.x + r.w && mp.y >= r.y && mp.y <= r.y + r.h) return "move";
    }
    return "crosshair";
  });

  const isBrushTool = () => BRUSH_TOOLS.has(tool());
  const brushCursorSize = () => Math.max(4, Math.round(strokeWidth() * (tool() === "highlight" ? 3 : 1)));

  // --- Toolbar position ---

  const toolbarPos = createMemo(() => {
    const r = sel();
    if (!r) return null;
    const TOOLBAR_H = 48;
    const GAP = 6;
    const fitsBelow = r.y + r.h + GAP + TOOLBAR_H < window.innerHeight;
    return { x: r.x, y: fitsBelow ? r.y + r.h + GAP : r.y - TOOLBAR_H - GAP, w: r.w };
  });

  // --- Mount ---

  onMount(async () => {
    window.addEventListener("keydown", handleKeyDown);
    const unlistens: (() => void)[] = [];

    // Register ALL listeners BEFORE emitting ready (race condition fix)
    unlistens.push(await listen<{ strings: Record<string, string> }>("screenshot-overlay:load-strings", (e) => {
      setStrings(e.payload.strings);
    }));

    unlistens.push(await listen<{ base64: string; imageWidth: number; imageHeight: number }>(
      "screenshot-overlay:load-image",
      (e) => {
        const b64 = e.payload.base64;
        const imgW = e.payload.imageWidth;
        const imgH = e.payload.imageHeight;
        const isJpeg = b64.startsWith("/9j/");
        const mime = isJpeg ? "image/jpeg" : "image/png";
        const img = new Image();
        img.onload = () => {
          imageRef = img;
          setImgDims({ w: imgW, h: imgH });
          if (canvasRef) {
            canvasRef.width = imgW;
            canvasRef.height = imgH;
          }
          resizeCanvasToWindow();
          redrawCanvas();
          void emitTo("main", "screenshot-overlay:show");
        };
        img.src = `data:${mime};base64,${b64}`;
      },
    ));

    // Re-render when window resizes (e.g. fullscreen → multi-monitor expansion)
    const handleResize = () => {
      resizeCanvasToWindow();
      redrawCanvas();
    };
    window.addEventListener("resize", handleResize);

    void emitTo("main", "screenshot-overlay:ready");

    onCleanup(() => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
      for (const fn of unlistens) fn();
    });
  });

  // --- Render ---

  return (
    <div
      class="fixed inset-0 select-none overflow-hidden"
      style={{ background: "#000", cursor: cursorStyle() }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => {
        setMousePos(null);
        if (mode() === "annotate") {
          if (tool() === "select") {
            setIsDraggingAnnotation(false);
            setActiveResizeHandle(null);
          } else if (isDrawing()) {
            annotateUp();
          }
        }
      }}
    >
      {/* Screenshot canvas — fills the window */}
      <canvas ref={canvasRef} class="block" style={{ width: "100%", height: "100%" }} />

      {/* Selection overlay with box-shadow darkening */}
      <Show when={sel() && (mode() === "selected" || mode() === "selecting" || mode() === "annotate")}>
        <div
          class="absolute pointer-events-none z-10"
          style={{
            left: `${sel()!.x}px`,
            top: `${sel()!.y}px`,
            width: `${sel()!.w}px`,
            height: `${sel()!.h}px`,
            border: "2px solid #3b82f6",
            "box-shadow": "0 0 0 9999px rgba(0,0,0,0.55)",
          }}
        />
        {/* Resize handles */}
        <For each={(["nw", "n", "ne", "e", "se", "s", "sw", "w"] as HandlePos[])}>
          {(pos) => {
            const coords = createMemo(() => {
              const r = sel();
              if (!r) return [0, 0];
              const m: Record<HandlePos, [number, number]> = {
                nw: [r.x, r.y], n: [r.x + r.w / 2, r.y], ne: [r.x + r.w, r.y],
                e: [r.x + r.w, r.y + r.h / 2], se: [r.x + r.w, r.y + r.h],
                s: [r.x + r.w / 2, r.y + r.h], sw: [r.x, r.y + r.h], w: [r.x, r.y + r.h / 2],
              };
              return m[pos];
            });
            return (
              <div
                class="absolute pointer-events-auto z-20"
                style={{
                  left: `${coords()[0] - HANDLE_SIZE / 2}px`,
                  top: `${coords()[1] - HANDLE_SIZE / 2}px`,
                  width: `${HANDLE_SIZE}px`,
                  height: `${HANDLE_SIZE}px`,
                  background: "#3b82f6",
                  border: "1.5px solid #fff",
                  cursor: HANDLE_CURSORS[pos],
                  "border-radius": "2px",
                }}
              />
            );
          }}
        </For>
      </Show>

      {/* Annotate canvas — positioned at selection */}
      <Show when={mode() === "annotate" && sel()}>
        <div
          class="absolute overflow-hidden z-10"
          style={{
            left: `${sel()!.x}px`,
            top: `${sel()!.y}px`,
            width: `${sel()!.w}px`,
            height: `${sel()!.h}px`,
          }}
        >
          <canvas
            ref={annotCanvasRef}
            class="block"
            style={{
              width: "100%",
              height: "100%",
              cursor: tool() === "select"
                ? (hoveredHandleCursor() || (activeResizeHandle() ? activeResizeHandle()!.cursor : "default"))
                : "none"
            }}
          />
        </div>
      </Show>

      {/* Brush cursor */}
      <Show when={mode() === "annotate" && mousePos() && tool() !== "select"}>
        <div
          class="pointer-events-none fixed z-30"
          style={{ left: `${mousePos()!.x}px`, top: `${mousePos()!.y}px`, transform: "translate(-50%, -50%)" }}
        >
          <Show when={isBrushTool()} fallback={
            <div class="relative" style={{ width: "20px", height: "20px" }}>
              <div class="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-foreground/80" />
              <div class="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-foreground/80" />
            </div>
          }>
            <div
              class="rounded-full border-2"
              style={{
                width: `${brushCursorSize()}px`, height: `${brushCursorSize()}px`,
                "border-color": color(),
                "background-color": tool() === "highlight" ? `${color()}33` : "transparent",
                "mix-blend-mode": "difference",
              }}
            />
          </Show>
        </div>
      </Show>

      {/* Hint */}
      <Show when={mode() === "idle"}>
        <div class="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-lg bg-background/90 px-5 py-2.5 text-sm shadow-lg backdrop-blur-sm border border-border z-20">
          {str("screenshot.selectRegionHint")}
        </div>
      </Show>

      {/* Toolbar */}
      <Show when={(mode() === "selecting" || mode() === "selected" || mode() === "annotate") && toolbarPos() && sel() && sel()!.w > 10 && sel()!.h > 10}>
        <div
          class="absolute z-30 flex items-center gap-2 rounded-lg border border-border bg-background/95 px-3 py-2 shadow-lg backdrop-blur-sm"
          style={{
            left: `${Math.max(8, toolbarPos()!.x)}px`,
            top: `${toolbarPos()!.y}px`,
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseMove={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
        >
          {/* Show during selection — just dimensions */}
          <Show when={mode() === "selecting"}>
            <span class="text-xs text-muted-foreground whitespace-nowrap">
              {Math.round(sel()!.w)} × {Math.round(sel()!.h)}
            </span>
          </Show>

          {/* Show after selection — full toolbar */}
          <Show when={mode() === "selected"}>
            <span class="text-xs text-muted-foreground whitespace-nowrap">
              {Math.round(sel()!.w)} × {Math.round(sel()!.h)}
            </span>
            <div class="h-4 w-px bg-border" />
            <button type="button" class="rounded px-3 py-1 text-xs font-medium hover:bg-accent" onClick={() => void handleCancel()}>
              {str("screenshot.cancel")}
            </button>
            <button type="button" class="rounded px-3 py-1 text-xs font-medium hover:bg-accent" onClick={() => { setSel(null); setMode("idle"); }}>
              {str("screenshot.reset")}
            </button>
            <button type="button" class="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90" onClick={startAnnotate}>
              <span class="iconify mdi--pencil mr-1 size-3.5" />{str("screenshot.annotate")}
            </button>
            <button type="button" class="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90" onClick={() => void handleSave()}>
              <span class="iconify mdi--content-save mr-1 size-3.5" />{str("screenshot.save")}
            </button>
            <button type="button" class="rounded px-3 py-1 text-xs font-medium hover:bg-accent" onClick={() => void handleCopy()}>
              <span class="iconify mdi--clipboard-text-multiple mr-1 size-3.5" />{str("screenshot.copyToClipboard")}
            </button>
          </Show>

          <Show when={mode() === "annotate"}>
            <For each={[
              { t: "select" as const, icon: "iconify mdi--cursor-default" },
              { t: "arrow" as const, icon: "iconify mdi--arrow-top-right" },
              { t: "rectangle" as const, icon: "iconify mdi--rectangle-outline" },
              { t: "freehand" as const, icon: "iconify mdi--draw" },
              { t: "highlight" as const, icon: "iconify mdi--marker" },
            ]}>
              {(item) => (
                <button type="button" class={`flex size-7 items-center justify-center rounded ${tool() === item.t ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`} onClick={() => setTool(item.t)}>
                  <span class={`${item.icon} text-base`} />
                </button>
              )}
            </For>
            <div class="h-4 w-px bg-border" />
            <For each={["#ef4444", "#f97316", "#22c55e", "#3b82f6", "#a855f7", "#ffffff"]}>
              {(c) => (
                <button type="button" class="size-5 rounded-full border-2 hover:scale-110" classList={{ "border-white scale-110": color() === c, "border-transparent": color() !== c }} style={{ "background-color": c }} onClick={() => setColor(c)} />
              )}
            </For>
            <div class="h-4 w-px bg-border" />
            <input type="range" min="1" max="10" value={strokeWidth()} onInput={(e) => setStrokeWidth(Number.parseInt(e.currentTarget.value))} class="w-14 accent-primary" />
            <button type="button" class="flex size-7 items-center justify-center rounded hover:bg-accent" onClick={undoAnnot}>
              <span class="iconify mdi--undo text-base" />
            </button>
            <div class="h-4 w-px bg-border" />
            <button type="button" class="rounded px-2.5 py-1 text-xs font-medium hover:bg-accent" onClick={() => void handleCancel()}>{str("screenshot.cancel")}</button>
            <button type="button" class="rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90" onClick={() => void handleSave()}>
              <span class="iconify mdi--content-save mr-1 size-3.5" />{str("screenshot.save")}
            </button>
            <button type="button" class="rounded px-2.5 py-1 text-xs font-medium hover:bg-accent" onClick={() => void handleCopy()}>
              <span class="iconify mdi--clipboard-text-multiple mr-1 size-3.5" />{str("screenshot.copyToClipboard")}
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  render(() => <ScreenshotOverlay />, root);
}
