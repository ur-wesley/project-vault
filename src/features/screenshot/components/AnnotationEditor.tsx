import {
  type Component,
  createSignal,
  createEffect,
  onMount,
  onCleanup,
  Show,
} from "solid-js";
import { Button } from "~/components/ui/button";
import { useI18n } from "~/lib/i18n-context";
import AnnotationToolbar from "./AnnotationToolbar";
import {
  type Annotation,
  type AnnotationTool,
  type Point,
  generateId,
  renderAll,
  drawAnnotation,
  hitTest,
  moveAnnotation,
  drawSelectionIndicator,
  type ResizeHandle,
  hitTestHandle,
  resizeAnnotation,
} from "../lib/canvas-tools";

interface AnnotationEditorProps {
  imageData: Uint8Array;
  onClose: () => void;
  onSave: (pngBytes: Uint8Array) => void;
  onCopy: (pngBytes: Uint8Array) => void;
}

const BRUSH_TOOLS: ReadonlySet<AnnotationTool> = new Set(["freehand", "highlight"]);

const AnnotationEditor: Component<AnnotationEditorProps> = (props) => {
  const { t } = useI18n();
  // eslint-disable-next-line no-unassigned-vars — Solid ref pattern
  let canvasRef: HTMLCanvasElement | undefined;
  // eslint-disable-next-line no-unassigned-vars — Solid ref pattern
  let containerRef: HTMLDivElement | undefined;
  // eslint-disable-next-line no-unassigned-vars — Solid ref pattern
  let imageRef: HTMLImageElement | undefined;

  const [tool, setTool] = createSignal<AnnotationTool>("arrow");
  const [color, setColor] = createSignal("#ef4444");
  const [strokeWidth, setStrokeWidth] = createSignal(3);
  const [annotations, setAnnotations] = createSignal<Annotation[]>([]);
  const [undoStack, setUndoStack] = createSignal<Annotation[][]>([]);
  const [redoStack, setRedoStack] = createSignal<Annotation[][]>([]);
  const [isDrawing, setIsDrawing] = createSignal(false);
  const [textInput, setTextInput] = createSignal<{
    x: number;
    y: number;
    canvasX: number;
    canvasY: number;
  } | null>(null);
  const [textValue, setTextValue] = createSignal("");
  const [canvasScale, setCanvasScale] = createSignal(1);
  const [imageLoaded, setImageLoaded] = createSignal(false);
  const [mousePos, setMousePos] = createSignal<{ x: number; y: number } | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = createSignal<string | null>(null);
  const [isDraggingAnnotation, setIsDraggingAnnotation] = createSignal(false);
  const [editingTextAnnotationId, setEditingTextAnnotationId] = createSignal<string | null>(null);
  let dragStartPt: Point | null = null;
  const [activeResizeHandle, setActiveResizeHandle] = createSignal<ResizeHandle | null>(null);
  const [hoveredHandleCursor, setHoveredHandleCursor] = createSignal<string | null>(null);

  const isBrushTool = () => BRUSH_TOOLS.has(tool());

  const pushUndo = () => {
    setUndoStack((prev) => [...prev, [...annotations()]]);
    setRedoStack([]);
  };

  const undo = () => {
    const stack = undoStack();
    if (stack.length === 0) return;
    const prev = stack[stack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    setRedoStack((r) => [...r, [...annotations()]]);
    setAnnotations(prev);
    redraw();
  };

  const redo = () => {
    const stack = redoStack();
    if (stack.length === 0) return;
    const next = stack[stack.length - 1];
    setRedoStack((s) => s.slice(0, -1));
    setUndoStack((r) => [...r, [...annotations()]]);
    setAnnotations(next);
    redraw();
  };

  const getCanvasPoint = (e: MouseEvent): Point | null => {
    if (!canvasRef) return null;
    const rect = canvasRef.getBoundingClientRect();
    const scale = canvasScale();
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale,
    };
  };

  let currentAnnotation: Annotation | null = null;

  const handleDblClick = (e: MouseEvent) => {
    if (tool() !== "select") return;
    const pt = getCanvasPoint(e);
    if (!pt) return;
    const clicked = [...annotations()].reverse().find((ann) => ann.tool === "text" && hitTest(ann, pt));
    if (clicked && clicked.tool === "text") {
      setEditingTextAnnotationId(clicked.id);
      setTextInput({
        x: e.clientX,
        y: e.clientY,
        canvasX: clicked.position.x,
        canvasY: clicked.position.y,
      });
      setTextValue(clicked.text);
    }
  };

  const handleMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    const pt = getCanvasPoint(e);
    if (!pt) return;

    if (tool() === "select") {
      const selId = selectedAnnotationId();
      if (selId) {
        const selectedAnn = annotations().find((a) => a.id === selId);
        if (selectedAnn) {
          const handle = hitTestHandle(selectedAnn, pt);
          if (handle) {
            setActiveResizeHandle(handle);
            pushUndo();
            return;
          }
        }
      }

      const clicked = [...annotations()].reverse().find((ann) => hitTest(ann, pt));
      if (clicked) {
        setSelectedAnnotationId(clicked.id);
        setIsDraggingAnnotation(true);
        dragStartPt = pt;
        pushUndo();
      } else {
        setSelectedAnnotationId(null);
      }
      redraw();
      return;
    }

    if (tool() === "text") {
      setTextInput({
        x: e.clientX,
        y: e.clientY,
        canvasX: pt.x,
        canvasY: pt.y,
      });
      setTextValue("");
      return;
    }

    setIsDrawing(true);
    pushUndo();
    const id = generateId();
    const base = { id, color: color(), strokeWidth: strokeWidth() };

    if (tool() === "arrow") {
      currentAnnotation = { ...base, tool: "arrow", start: pt, end: pt };
    } else if (tool() === "rectangle") {
      currentAnnotation = { ...base, tool: "rectangle", start: pt, end: pt };
    } else if (tool() === "freehand") {
      currentAnnotation = { ...base, tool: "freehand", points: [pt] };
    } else if (tool() === "highlight") {
      currentAnnotation = { ...base, tool: "highlight", points: [pt] };
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    // Track mouse for brush cursor
    setMousePos({ x: e.clientX, y: e.clientY });

    const pt = getCanvasPoint(e);
    if (!pt) return;

    if (tool() === "select") {
      if (activeResizeHandle() && selectedAnnotationId()) {
        setAnnotations((prev) =>
          prev.map((ann) =>
            ann.id === selectedAnnotationId()
              ? resizeAnnotation(ann, activeResizeHandle()!.id, pt)
              : ann
          )
        );
        redraw();
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
          redraw();
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

    if (
      currentAnnotation.tool === "arrow" ||
      currentAnnotation.tool === "rectangle"
    ) {
      currentAnnotation.end = pt;
    } else if (
      currentAnnotation.tool === "freehand" ||
      currentAnnotation.tool === "highlight"
    ) {
      currentAnnotation.points.push(pt);
    }

    // Redraw with live preview of the in-progress annotation
    redrawWithLive();
  };

  const handleMouseUp = () => {
    if (tool() === "select") {
      setIsDraggingAnnotation(false);
      setActiveResizeHandle(null);
      return;
    }

    if (!isDrawing() || !currentAnnotation) return;
    setIsDrawing(false);

    const anns = [...annotations(), currentAnnotation];
    setAnnotations(anns);
    currentAnnotation = null;
    redraw();
  };

  const handleMouseLeave = () => {
    setMousePos(null);
    if (tool() === "select") {
      setIsDraggingAnnotation(false);
      setActiveResizeHandle(null);
      return;
    }

    if (isDrawing() && currentAnnotation) {
      setIsDrawing(false);
      const anns = [...annotations(), currentAnnotation];
      setAnnotations(anns);
      currentAnnotation = null;
      redraw();
    }
  };

  const commitText = () => {
    const tp = textInput();
    if (!tp) {
      setTextInput(null);
      setEditingTextAnnotationId(null);
      return;
    }
    const val = textValue().trim();
    if (!val) {
      if (editingTextAnnotationId()) {
        pushUndo();
        setAnnotations((prev) => prev.filter((a) => a.id !== editingTextAnnotationId()));
      }
      setTextInput(null);
      setEditingTextAnnotationId(null);
      redraw();
      return;
    }
    pushUndo();
    if (editingTextAnnotationId()) {
      setAnnotations((prev) =>
        prev.map((a) =>
          a.id === editingTextAnnotationId() && a.tool === "text"
            ? { ...a, text: val }
            : a
        )
      );
    } else {
      const ann: Annotation = {
        id: generateId(),
        tool: "text",
        color: color(),
        strokeWidth: strokeWidth(),
        position: { x: tp.canvasX, y: tp.canvasY },
        text: val,
        fontSize: Math.max(16, strokeWidth() * 6),
      };
      setAnnotations((prev) => [...prev, ann]);
    }
    setTextInput(null);
    setEditingTextAnnotationId(null);
    setTextValue("");
    redraw();
  };

  /** Redraw committed annotations only */
  const redraw = () => {
    if (!canvasRef || !imageRef) return;
    const ctx = canvasRef.getContext("2d");
    if (!ctx) return;
    renderAll(ctx, imageRef, annotations());
    const selId = selectedAnnotationId();
    if (selId && tool() === "select") {
      const selectedAnn = annotations().find((a) => a.id === selId);
      if (selectedAnn) {
        drawSelectionIndicator(ctx, selectedAnn);
      }
    }
  };

  /** Redraw committed annotations + the in-progress one for live preview */
  const redrawWithLive = () => {
    if (!canvasRef || !imageRef) return;
    const ctx = canvasRef.getContext("2d");
    if (!ctx) return;
    renderAll(ctx, imageRef, annotations());
    if (currentAnnotation) {
      drawAnnotation(ctx, currentAnnotation);
    }
    const selId = selectedAnnotationId();
    if (selId && tool() === "select") {
      const selectedAnn = annotations().find((a) => a.id === selId);
      if (selectedAnn) {
        drawSelectionIndicator(ctx, selectedAnn);
      }
    }
  };

  const flattenToUint8Array = (): Uint8Array | null => {
    if (!canvasRef) return null;
    const dataUrl = canvasRef.toDataURL("image/png");
    const base64 = dataUrl.split(",")[1];
    if (!base64) return null;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  };

  const handleSave = () => {
    const data = flattenToUint8Array();
    if (!data) return;
    props.onSave(data);
  };

  const handleCopy = () => {
    const data = flattenToUint8Array();
    if (!data) return;
    props.onCopy(data);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (textInput()) return;
    if (selectedAnnotationId() && tool() === "select" && (e.key === "Delete" || e.key === "Backspace")) {
      e.preventDefault();
      pushUndo();
      setAnnotations((prev) => prev.filter((a) => a.id !== selectedAnnotationId()));
      setSelectedAnnotationId(null);
      redraw();
      return;
    }
    if (e.ctrlKey && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (e.ctrlKey && e.key === "z" && e.shiftKey) {
      e.preventDefault();
      redo();
    } else if (e.ctrlKey && e.key === "Z") {
      e.preventDefault();
      redo();
    } else if (e.key === "Escape") {
      props.onClose();
    } else if (e.ctrlKey && e.key === "s") {
      e.preventDefault();
      handleSave();
    }
  };

  onMount(() => {
    window.addEventListener("keydown", handleKeyDown);

    const img = new Image();
    img.onload = () => {
      imageRef = img;
      setImageLoaded(true);

      if (containerRef && canvasRef) {
        const containerW = containerRef.clientWidth - 40;
        const containerH = containerRef.clientHeight - 120;
        const scaleX = containerW / img.width;
        const scaleY = containerH / img.height;
        const scale = Math.min(1, scaleX, scaleY);
        setCanvasScale(scale);

        canvasRef.width = img.width;
        canvasRef.height = img.height;
        canvasRef.style.width = `${img.width * scale}px`;
        canvasRef.style.height = `${img.height * scale}px`;

        redraw();
      }
    };
    const blob = new Blob([props.imageData as any], { type: "image/png" });
    img.src = URL.createObjectURL(blob);
  });

  onCleanup(() => {
    window.removeEventListener("keydown", handleKeyDown);
  });

  createEffect(() => {
    annotations();
    redraw();
  });

  // Brush cursor size in screen pixels (scale strokeWidth by canvasScale)
  const brushCursorSize = () => {
    const s = canvasScale();
    const sw = strokeWidth();
    // For highlight, the effective width is 3x
    const multiplier = tool() === "highlight" ? 3 : 1;
    return Math.max(4, Math.round(sw * s * multiplier));
  };

  return (
    <div class="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm">
      <div
        ref={containerRef}
        class="relative flex flex-1 items-center justify-center overflow-hidden p-5"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onDblClick={handleDblClick}
      >
        <Show when={imageLoaded()} fallback={<span class="text-muted-foreground">{t("screenshot.loading")}</span>}>
          <canvas
            ref={canvasRef}
            class="rounded shadow-2xl"
            style={{
              cursor: tool() === "select"
                ? (hoveredHandleCursor() || (activeResizeHandle() ? activeResizeHandle()!.cursor : "default"))
                : "none"
            }}
          />
        </Show>

        {/* Custom brush cursor */}
        <Show when={mousePos() && imageLoaded() && tool() !== "select"}>
          <div
            class="pointer-events-none fixed z-[60]"
            style={{
              left: `${mousePos()!.x}px`,
              top: `${mousePos()!.y}px`,
              transform: "translate(-50%, -50%)",
            }}
          >
            <Show
              when={isBrushTool()}
              fallback={
                /* Crosshair for arrow/rectangle */
                <div class="relative" style={{ width: "20px", height: "20px" }}>
                  <div class="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-foreground/80" />
                  <div class="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-foreground/80" />
                </div>
              }
            >
              {/* Brush circle for freehand/highlight */}
              <div
                class="rounded-full border-2"
                style={{
                  width: `${brushCursorSize()}px`,
                  height: `${brushCursorSize()}px`,
                  "border-color": color(),
                  "background-color": tool() === "highlight" ? `${color()}33` : "transparent",
                  "mix-blend-mode": "difference",
                }}
              />
            </Show>
          </div>
        </Show>

        <Show when={textInput()}>
          <div
            class="absolute z-50"
            style={{
              left: `${textInput()!.x}px`,
              top: `${textInput()!.y}px`,
            }}
          >
            <div class="flex gap-1 rounded border border-border bg-background p-1 shadow-lg">
              <input
                type="text"
                autofocus
                value={textValue()}
                onInput={(e) => setTextValue(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitText();
                  if (e.key === "Escape") setTextInput(null);
                }}
                onBlur={() => commitText()}
                class="w-48 bg-transparent px-2 py-1 text-sm outline-none"
                placeholder={t("screenshot.typeText")}
              />
            </div>
          </div>
        </Show>
      </div>

      <div class="flex items-center justify-center border-t border-border bg-background/95 px-4 py-2">
        <AnnotationToolbar
          activeTool={tool()}
          onToolChange={setTool}
          color={color()}
          onColorChange={setColor}
          strokeWidth={strokeWidth()}
          onStrokeWidthChange={setStrokeWidth}
          onUndo={undo}
          onRedo={redo}
          canUndo={undoStack().length > 0}
          canRedo={redoStack().length > 0}
        />
      </div>

      <div class="flex items-center justify-center gap-3 border-t border-border bg-background px-4 py-3">
        <Button variant="ghost" onClick={props.onClose}>
          {t("screenshot.cancel")}
        </Button>
        <Button variant="outline" onClick={handleCopy}>
          <span class="iconify mdi--clipboard-text-multiple size-4" />
          {t("screenshot.copyToClipboard")}
        </Button>
        <Button onClick={handleSave}>
          <span class="iconify mdi--content-save size-4" />
          {t("screenshot.save")}
        </Button>
      </div>
    </div>
  );
};

export default AnnotationEditor;
