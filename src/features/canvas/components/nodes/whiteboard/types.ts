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

export type BackgroundStyle = "transparent" | "solid" | "hachure" | "cross-hatch";
export type StrokeStyleKind = "solid" | "dashed" | "dotted";
export type Roundness = "sharp" | "round";
export type FontFamily = "hand" | "normal" | "code";
export type Arrowhead = "none" | "arrow" | "dot";

export interface WhiteboardElementBase {
  id: string;
  color: string;
  strokeWidth: number;
  background: BackgroundStyle;
  fillColor: string;
  strokeStyle: StrokeStyleKind;
  /** 10..100 */
  opacity: number;
  roundness: Roundness;
  /** Single-level group membership (outermost-first). v1 enforces max depth 1. */
  groupIds: string[];
  /** Ids of text elements bound to this container. */
  boundElements: { type: "text"; id: string }[];
}

export interface FreehandElement extends WhiteboardElementBase {
  kind: "freehand";
  points: WhiteboardPoint[];
}

export interface RectangleElement extends WhiteboardElementBase {
  kind: "rectangle";
  start: WhiteboardPoint;
  end: WhiteboardPoint;
}

export interface EllipseElement extends WhiteboardElementBase {
  kind: "ellipse";
  start: WhiteboardPoint;
  end: WhiteboardPoint;
}

export interface DiamondElement extends WhiteboardElementBase {
  kind: "diamond";
  start: WhiteboardPoint;
  end: WhiteboardPoint;
}

export type BindSide = "n" | "s" | "e" | "w";

export interface ElementBinding {
  elementId: string;
  /** Gap in px between the target boundary and the arrow endpoint. */
  gap: number;
  /** Sticky side anchor (Excalidraw-like). Null = legacy ray-slide behavior. */
  side?: BindSide | null;
  /** Normalized offset along the side (-1..1). 0 = side center. */
  focus?: number | null;
}

export interface ArrowElement extends WhiteboardElementBase {
  kind: "arrow";
  start: WhiteboardPoint;
  end: WhiteboardPoint;
  startBinding: ElementBinding | null;
  endBinding: ElementBinding | null;
  startArrow: Arrowhead;
  endArrow: Arrowhead;
  /**
   * Bend vertices for multi-point connectors (polyline start → … → end).
   * Empty = straight. Rendered as a smooth curve when non-empty.
   * Stored absolute; replayed relative to the resolved chord so bound
   * shapes can move without distorting the bends.
   */
  waypoints: WhiteboardPoint[];
}

export interface LineElement extends WhiteboardElementBase {
  kind: "line";
  start: WhiteboardPoint;
  end: WhiteboardPoint;
  startBinding: ElementBinding | null;
  endBinding: ElementBinding | null;
  startArrow: Arrowhead;
  endArrow: Arrowhead;
  /** Bend vertices (see ArrowElement.waypoints). Empty = straight. */
  waypoints: WhiteboardPoint[];
}

export interface TextElement extends WhiteboardElementBase {
  kind: "text";
  position: WhiteboardPoint;
  text: string;
  fontSize: number;
  fontFamily: FontFamily;
  bold: boolean;
  italic: boolean;
  /** Id of the shape/arrow this text is bound to (label), or null for free text. */
  containerId: string | null;
  /** Id of the group this text labels, or null. */
  labelGroupId: string | null;
  /** Custom offset from the derived (centered/midpoint) position. */
  offset: WhiteboardPoint;
  /**
   * Fixed wrap width in px (drag-created free text). Null = auto-width
   * (click-created free text, or bound text which wraps to its container).
   */
  width: number | null;
  /** Horizontal alignment: bound labels center, free text left. */
  textAlign: "left" | "center" | "right";
}

export type WhiteboardElement =
  | FreehandElement
  | RectangleElement
  | EllipseElement
  | DiamondElement
  | ArrowElement
  | LineElement
  | TextElement;

export type ShapeKind = "rectangle" | "ellipse" | "diamond";

export type BoundTargetKind = ShapeKind | "arrow" | "line";

/** Elements that can carry bound text: shapes and arrows/lines. */
export function isBindableContainer(el: WhiteboardElement): boolean {
  return (
    el.kind === "rectangle" ||
    el.kind === "ellipse" ||
    el.kind === "diamond" ||
    el.kind === "arrow" ||
    el.kind === "line"
  );
}

/** Elements an arrow endpoint can bind to: shapes only (not text/freehand). */
export function isArrowBindTarget(el: WhiteboardElement): boolean {
  return el.kind === "rectangle" || el.kind === "ellipse" || el.kind === "diamond";
}

export const DEFAULT_BIND_GAP = 4;

export interface ElementStylePatch {
  color?: string;
  strokeWidth?: number;
  background?: BackgroundStyle;
  fillColor?: string;
  strokeStyle?: StrokeStyleKind;
  opacity?: number;
  roundness?: Roundness;
  fontSize?: number;
  fontFamily?: FontFamily;
  textAlign?: "left" | "center" | "right";
  bold?: boolean;
  italic?: boolean;
  startArrow?: Arrowhead;
  endArrow?: Arrowhead;
}

/** Excalidraw-like defaults shared by new elements and migrated boards. */
export const DEFAULT_ELEMENT_STYLE: Required<
  Pick<WhiteboardElementBase, "background" | "fillColor" | "strokeStyle" | "opacity" | "roundness">
> = {
  background: "transparent",
  fillColor: "#3b82f6",
  strokeStyle: "solid",
  opacity: 100,
  roundness: "round",
};

export const DEFAULT_TEXT_STYLE = {
  fontSize: 16,
  fontFamily: "normal" as FontFamily,
  textAlign: "left" as const,
  bold: false,
  italic: false,
};

export const DEFAULT_CONNECTOR_ARROWS: { startArrow: Arrowhead; endArrow: Arrowhead } = {
  startArrow: "none",
  endArrow: "arrow",
};

export const FONT_STACKS: Record<FontFamily, string> = {
  hand: '"Segoe Print", "Bradley Hand", cursive',
  normal: "system-ui, sans-serif",
  code: 'ui-monospace, "Cascadia Code", monospace',
};

export function baseElement(
  id: string,
  color: string,
  strokeWidth: number,
  style?: ElementStylePatch,
): WhiteboardElementBase {
  return {
    id,
    color,
    strokeWidth,
    background: style?.background ?? DEFAULT_ELEMENT_STYLE.background,
    fillColor: style?.fillColor ?? DEFAULT_ELEMENT_STYLE.fillColor,
    strokeStyle: style?.strokeStyle ?? DEFAULT_ELEMENT_STYLE.strokeStyle,
    opacity: style?.opacity ?? DEFAULT_ELEMENT_STYLE.opacity,
    roundness: style?.roundness ?? DEFAULT_ELEMENT_STYLE.roundness,
    groupIds: [],
    boundElements: [],
  };
}

export function stylePatchForElement(el: WhiteboardElement): ElementStylePatch {
  const patch: ElementStylePatch = {
    color: el.color,
    strokeWidth: el.strokeWidth,
    background: el.background,
    fillColor: el.fillColor,
    strokeStyle: el.strokeStyle,
    opacity: el.opacity,
    roundness: el.roundness,
  };
  if (el.kind === "arrow" || el.kind === "line") {
    patch.startArrow = el.startArrow;
    patch.endArrow = el.endArrow;
  }
  if (el.kind === "text") {
    patch.fontSize = el.fontSize;
    patch.fontFamily = el.fontFamily;
    patch.textAlign = el.textAlign;
    patch.bold = el.bold;
    patch.italic = el.italic;
  }
  return patch;
}

export interface WhiteboardData {
  version: number;
  elements: WhiteboardElement[];
}

export const WHITEBOARD_SCHEMA_VERSION = 5 as const;

export const EMPTY_WHITEBOARD: WhiteboardData = {
  version: WHITEBOARD_SCHEMA_VERSION,
  elements: [],
};

export function createElementId(): string {
  return `wb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
