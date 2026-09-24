import { For, createSignal, type Component } from "solid-js";
import type { CanvasNodeDto, CanvasWireDto, ProjectDto } from "~/types/dto";
import { CanvasWiresOverlay, type WireAnchor, type WirePendingPreview } from "./CanvasWiresOverlay";
import { CanvasNodeRenderer } from "./nodes/CanvasNodeRenderer";
import { CanvasPortsOverlay, type ActiveDrag, type DragPort } from "./CanvasPortsOverlay";

interface CanvasSurfaceProps {
  nodes: CanvasNodeDto[];
  wires: CanvasWireDto[];
  project: () => ProjectDto;
  isDraggable?: boolean;
  snapEnabled?: boolean;
  zoom?: number;
  transformStyle: string;
  onMouseDown: (e: MouseEvent) => void;
  onMouseMove: (e: MouseEvent) => void;
  onMouseUp: () => void;
  onWheel: (e: WheelEvent) => void;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onResize?: (id: string, width: number, height: number) => void;
  onDeleteNode?: (id: string) => void;
  onPinToggle?: (id: string) => void;
  onStartDrag?: () => void;
  onFocusNode?: (id: string) => void;
  focusedId?: string | null;
  fullscreenId?: string | null;
  onToggleFullscreen?: (id: string) => void;
  onNodeDataChange?: (id: string, dataJson: string | null) => void;
  onTitleChange?: (id: string, title: string) => void;
  onWireAction?: (wire: CanvasWireDto) => void;
  selectedWireId?: string | null;
  pending?: WirePendingPreview | null;
  drag?: ActiveDrag | null;
  cursorWorld?: { x: number; y: number } | null;
  onWireSelect?: (wireId: string, anchor: WireAnchor) => void;
  onPortPointerDown?: (sourceId: string, port: DragPort, e: PointerEvent) => void;
  onEmptyPointerDown?: () => void;
  onCursorWorldChange?: (world: { x: number; y: number } | null) => void;
  screenToWorld?: (screenX: number, screenY: number) => { x: number; y: number };
}

export const CanvasSurface: Component<CanvasSurfaceProps> = (props) => {
  // eslint-disable-next-line no-unassigned-vars -- Solid ref pattern
  let surfaceRef: HTMLDivElement | undefined;
  const [hoveredId, setHoveredId] = createSignal<string | null>(null);

  const handleWheel = (e: WheelEvent) => {
    if (!surfaceRef) return;
    props.onWheel(e);
  };

  const handleMouseMove = (e: MouseEvent) => {
    props.onMouseMove(e);
    // Proximity port dots need the cursor in world coords. Convert from
    // container-relative screen coords; null the cursor when it leaves.
    if (props.screenToWorld && surfaceRef) {
      const rect = surfaceRef.getBoundingClientRect();
      props.onCursorWorldChange?.(props.screenToWorld(e.clientX - rect.left, e.clientY - rect.top));
    }
  };

  return (
    <div
      ref={surfaceRef}
      data-canvas-surface="true"
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).dataset?.canvasSurface === "true") {
          props.onEmptyPointerDown?.();
        }
        props.onMouseDown(e);
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => props.onCursorWorldChange?.(null)}
      onMouseUp={props.onMouseUp}
      onMouseOver={(e) => {
        const id = (e.target as HTMLElement)
          .closest?.("[data-canvas-node-id]")
          ?.getAttribute("data-canvas-node-id");
        setHoveredId(id ?? null);
      }}
      onWheel={handleWheel}
      class="relative h-full w-full flex-1 overflow-hidden select-none bg-[#090d16]"
    >
      {/* Viewport Transform Layer (no CSS transition: native overlays track
          the live rect every frame — any glide makes them shear) */}
      <div
        class="absolute inset-0 h-full w-full origin-top-left"
        style={{
          transform: props.transformStyle,
        }}
      >
        {/* Endless dot grid — lives inside the transform so it pans/zooms with the world */}
        <div
          aria-hidden="true"
          class="pointer-events-none absolute"
          style={{
            width: "20000px",
            height: "20000px",
            left: "-10000px",
            top: "-10000px",
            "background-image":
              "radial-gradient(circle, rgba(148, 163, 184, 0.14) 1px, transparent 1px)",
            "background-size": "24px 24px",
          }}
        />
        {/* SVG Connection Wires Layer */}
        <CanvasWiresOverlay
          wires={props.wires}
          nodes={props.nodes}
          selectedWireId={props.selectedWireId}
          pending={props.pending}
          onWireSelect={props.onWireSelect}
          onActionClick={props.onWireAction}
        />

        {/* Nodes Layer */}
        <For each={props.nodes}>
          {(node) => (
            <CanvasNodeRenderer
              node={node}
              project={props.project}
              allNodes={props.nodes}
              isDraggable={props.isDraggable}
              snapEnabled={props.snapEnabled}
              zoom={props.zoom}
              isFocused={props.focusedId === node.id}
              isFullscreen={props.fullscreenId === node.id}
              onPositionChange={props.onPositionChange}
              onResize={props.onResize}
              onDelete={props.onDeleteNode}
              onPinToggle={props.onPinToggle}
              onStartDrag={props.onStartDrag}
              onFocusNode={props.onFocusNode}
              onToggleFullscreen={props.onToggleFullscreen}
              onDataChange={props.onNodeDataChange}
              onTitleChange={props.onTitleChange}
            />
          )}
        </For>

        {/* Connection port dots (drag to create wires) */}
        <CanvasPortsOverlay
          nodes={props.nodes}
          activeId={hoveredId() ?? props.focusedId ?? null}
          pendingSourceId={props.pending?.sourceId ?? null}
          drag={props.drag ?? null}
          cursorWorld={props.cursorWorld ?? null}
          onPortPointerDown={props.onPortPointerDown}
        />
      </div>
    </div>
  );
};
