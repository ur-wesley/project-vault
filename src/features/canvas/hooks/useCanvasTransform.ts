import { createSignal, createMemo, onCleanup } from "solid-js";
import type { ViewportDto, CanvasNodeDto } from "~/types/dto";
import { resolveRenderGeometry, type MeasuredBox } from "../geometry/measuredSizes";

export const GRID_SIZE = 16;

export function snapToGrid(value: number, enabled: boolean = true): number {
  if (!enabled) return value;
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

export function useCanvasTransform(initialViewport?: ViewportDto) {
  const [panX, setPanX] = createSignal(initialViewport?.panX ?? 0);
  const [panY, setPanY] = createSignal(initialViewport?.panY ?? 0);
  const [zoom, setZoom] = createSignal(initialViewport?.zoom ?? 1.0);
  const [isPanning, setIsPanning] = createSignal(false);
  const [snapEnabled, setSnapEnabled] = createSignal(true);

  let lastMouseX = 0;
  let lastMouseY = 0;

  // rAF coalescing: mousemove can fire 2-4x per display frame. Accumulate
  // deltas and apply once per frame so transformStyle/minimap/wires recompute
  // at most at display refresh rate instead of event rate.
  let pendingDX = 0;
  let pendingDY = 0;
  let panRaf = 0;

  const flushPan = () => {
    panRaf = 0;
    const dx = pendingDX;
    const dy = pendingDY;
    pendingDX = 0;
    pendingDY = 0;
    if (dx !== 0) setPanX((prev) => prev + dx);
    if (dy !== 0) setPanY((prev) => prev + dy);
  };

  const cancelCoalesced = () => {
    if (panRaf) {
      window.cancelAnimationFrame(panRaf);
      panRaf = 0;
    }
    pendingDX = 0;
    pendingDY = 0;
  };

  onCleanup(cancelCoalesced);

  const transformStyle = createMemo(() => {
    return `translate3d(${panX()}px, ${panY()}px, 0) scale(${zoom()})`;
  });

  const handleMouseDown = (e: MouseEvent) => {
    // Start pan on middle mouse button (1) or left button (0) when clicking canvas surface
    if (
      e.button === 1 ||
      (e.button === 0 && (e.target as HTMLElement).dataset?.canvasSurface === "true")
    ) {
      e.preventDefault();
      setIsPanning(true);
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isPanning()) return;
    const dx = e.clientX - lastMouseX;
    const dy = e.clientY - lastMouseY;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;

    pendingDX += dx;
    pendingDY += dy;
    if (!panRaf) panRaf = window.requestAnimationFrame(flushPan);
  };

  const handleMouseUp = () => {
    // Flush any pending pan so no pointer delta is lost when the button
    // is released before the next frame.
    if (panRaf) {
      window.cancelAnimationFrame(panRaf);
      panRaf = 0;
      const dx = pendingDX;
      const dy = pendingDY;
      pendingDX = 0;
      pendingDY = 0;
      if (dx !== 0) setPanX((prev) => prev + dx);
      if (dy !== 0) setPanY((prev) => prev + dy);
    }
    setIsPanning(false);
  };

  const handleWheel = (e: WheelEvent, containerRect: DOMRect) => {
    e.preventDefault();

    const zoomFactor = 1.1;
    const isZoomIn = e.deltaY < 0;
    const newZoom = isZoomIn
      ? Math.min(zoom() * zoomFactor, 4.0)
      : Math.max(zoom() / zoomFactor, 0.1);

    // Zoom centered around mouse pointer
    const mouseX = e.clientX - containerRect.left;
    const mouseY = e.clientY - containerRect.top;

    const scaleChange = newZoom / zoom();
    const newPanX = mouseX - (mouseX - panX()) * scaleChange;
    const newPanY = mouseY - (mouseY - panY()) * scaleChange;

    setZoom(newZoom);
    setPanX(newPanX);
    setPanY(newPanY);
  };

  const resetView = () => {
    cancelCoalesced();
    setPanX(0);
    setPanY(0);
    setZoom(1.0);
  };

  const fitView = (
    nodes: CanvasNodeDto[],
    containerWidth: number,
    containerHeight: number,
    sizes: Record<string, MeasuredBox> = {},
  ) => {
    if (nodes.length === 0) {
      resetView();
      return;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const n of nodes) {
      // Rendered box, not raw DTO: auto-height / minimized nodes report
      // their measured size so framing matches what's on screen.
      const g = resolveRenderGeometry(n, sizes);
      minX = Math.min(minX, g.x);
      minY = Math.min(minY, g.y);
      maxX = Math.max(maxX, g.x + g.width);
      maxY = Math.max(maxY, g.y + g.height);
    }

    const padding = 80;
    const boundingWidth = maxX - minX + padding * 2;
    const boundingHeight = maxY - minY + padding * 2;

    const scaleX = containerWidth / boundingWidth;
    const scaleY = containerHeight / boundingHeight;
    const targetZoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.1), 1.2);

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    cancelCoalesced();
    setZoom(targetZoom);
    setPanX(containerWidth / 2 - centerX * targetZoom);
    setPanY(containerHeight / 2 - centerY * targetZoom);
  };

  const setViewport = (viewport: ViewportDto) => {
    cancelCoalesced();
    setPanX(viewport.panX);
    setPanY(viewport.panY);
    setZoom(viewport.zoom);
  };

  const screenToWorld = (screenX: number, screenY: number) => ({
    x: (screenX - panX()) / zoom(),
    y: (screenY - panY()) / zoom(),
  });

  return {
    panX,
    panY,
    zoom,
    setPanX,
    setPanY,
    setZoom,
    setViewport,
    screenToWorld,
    isPanning,
    snapEnabled,
    setSnapEnabled,
    transformStyle,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleWheel,
    resetView,
    fitView,
    getViewport: (): ViewportDto => ({
      panX: panX(),
      panY: panY(),
      zoom: zoom(),
    }),
  };
}
