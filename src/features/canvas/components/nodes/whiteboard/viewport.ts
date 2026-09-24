import type { WhiteboardPoint } from "./types";

/** Zoom bounds match the outer canvas (useCanvasTransform). */
export const WB_MIN_ZOOM = 0.1;
export const WB_MAX_ZOOM = 4;
export const WB_ZOOM_FACTOR = 1.1;

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(WB_MAX_ZOOM, Math.max(WB_MIN_ZOOM, z));
}

export function screenToWorld(
  sx: number,
  sy: number,
  panX: number,
  panY: number,
  zoom: number,
): WhiteboardPoint {
  return { x: (sx - panX) / zoom, y: (sy - panY) / zoom };
}

export function worldToScreen(
  wx: number,
  wy: number,
  panX: number,
  panY: number,
  zoom: number,
): WhiteboardPoint {
  return { x: wx * zoom + panX, y: wy * zoom + panY };
}

export interface ZoomStep {
  panX: number;
  panY: number;
  zoom: number;
}

/**
 * Cursor-anchored zoom step (mirrors useCanvasTransform.handleWheel):
 * the world point under the cursor stays under the cursor.
 */
export function zoomAtScreen(
  panX: number,
  panY: number,
  zoom: number,
  screenX: number,
  screenY: number,
  zoomIn: boolean,
): ZoomStep {
  const next = clampZoom(zoomIn ? zoom * WB_ZOOM_FACTOR : zoom / WB_ZOOM_FACTOR);
  const scaleChange = next / zoom;
  return {
    panX: screenX - (screenX - panX) * scaleChange,
    panY: screenY - (screenY - panY) * scaleChange,
    zoom: next,
  };
}
