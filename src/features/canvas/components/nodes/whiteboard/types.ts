/**
 * Whiteboard model — Excalidraw-native.
 *
 * Canonical types live in `./excalidrawTypes` (Zod schemas + inferred types)
 * and `./excalidrawDefaults` (`newElement` factory, `emptyScene`). This module
 * only re-exports them plus thin local aliases.
 */
import type { ExcalidrawElement, ExcalidrawScene } from "./excalidrawTypes";

export type {
  ExcalidrawAppState,
  ExcalidrawArrowElement,
  ExcalidrawDiamondElement,
  ExcalidrawElement,
  ExcalidrawElementBase,
  ExcalidrawElementType,
  ExcalidrawEllipseElement,
  ExcalidrawFiles,
  ExcalidrawFrameElement,
  ExcalidrawFreedrawElement,
  ExcalidrawImageElement,
  ExcalidrawLineElement,
  ExcalidrawRectangleElement,
  ExcalidrawScene,
  ExcalidrawTextElement,
} from "./excalidrawTypes";
export {
  EXCALIDRAW_SCENE_VERSION,
  EXCALIDRAW_SOURCE,
  ExcalidrawElementSchema,
  ExcalidrawSceneSchema,
} from "./excalidrawTypes";
export { createElementId, emptyScene, newElement } from "./excalidrawDefaults";
export type { NewElementPatch } from "./excalidrawDefaults";

export interface WhiteboardPoint {
  x: number;
  y: number;
}

export type WhiteboardTool =
  | "select"
  | "freehand"
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "arrow"
  | "line"
  | "text"
  | "eraser";

/** Thin alias: board elements are Excalidraw elements. */
export type WhiteboardElement = ExcalidrawElement;
/** Thin alias: board data is an Excalidraw v2 scene. */
export type WhiteboardData = ExcalidrawScene;
