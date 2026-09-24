/**
 * True node fullscreen: 1:1 scale with the node resized to fill the canvas.
 * Pure math (no Solid) so the layout is unit-testable; CanvasView applies
 * the result via the transform + node sizing calls.
 */
export const FULLSCREEN_PAD_SIDE = 16;
export const FULLSCREEN_PAD_BOTTOM = 16;
/** Top gap leaves the floating toolbar clear of the node header. */
export const FULLSCREEN_PAD_TOP = 64;

export interface FullscreenLayout {
  zoom: 1;
  panX: number;
  panY: number;
  width: number;
  height: number;
}

/**
 * Camera moves the node's top-left to the padded origin at zoom 1 and the
 * node is resized to the remaining viewport space. Node x/y never change —
 * only the camera and the node size do, so exit is a pure restore.
 */
export function computeFullscreenLayout(
  nodeX: number,
  nodeY: number,
  containerWidth: number,
  containerHeight: number,
): FullscreenLayout | null {
  if (containerWidth <= 0 || containerHeight <= 0) return null;
  const width = Math.max(240, containerWidth - FULLSCREEN_PAD_SIDE * 2);
  const height = Math.max(140, containerHeight - FULLSCREEN_PAD_TOP - FULLSCREEN_PAD_BOTTOM);
  return {
    zoom: 1,
    panX: FULLSCREEN_PAD_SIDE - nodeX,
    panY: FULLSCREEN_PAD_TOP - nodeY,
    width: Math.round(width),
    height: Math.round(height),
  };
}
