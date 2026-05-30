export type AnnotationTool = "arrow" | "rectangle" | "freehand" | "text" | "highlight" | "select";

export interface Point {
  x: number;
  y: number;
}

export interface AnnotationBase {
  id: string;
  tool: AnnotationTool;
  color: string;
  strokeWidth: number;
}

export interface ArrowAnnotation extends AnnotationBase {
  tool: "arrow";
  start: Point;
  end: Point;
}

export interface RectangleAnnotation extends AnnotationBase {
  tool: "rectangle";
  start: Point;
  end: Point;
}

export interface FreehandAnnotation extends AnnotationBase {
  tool: "freehand";
  points: Point[];
}

export interface TextAnnotation extends AnnotationBase {
  tool: "text";
  position: Point;
  text: string;
  fontSize: number;
}

export interface HighlightAnnotation extends AnnotationBase {
  tool: "highlight";
  points: Point[];
}

export type Annotation =
  | ArrowAnnotation
  | RectangleAnnotation
  | FreehandAnnotation
  | TextAnnotation
  | HighlightAnnotation;

export function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function drawAnnotation(ctx: CanvasRenderingContext2D, ann: Annotation) {
  ctx.save();
  ctx.strokeStyle = ann.color;
  ctx.fillStyle = ann.color;
  ctx.lineWidth = ann.strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  switch (ann.tool) {
    case "arrow":
      drawArrow(ctx, ann);
      break;
    case "rectangle":
      drawRectangle(ctx, ann);
      break;
    case "freehand":
      drawFreehand(ctx, ann);
      break;
    case "text":
      drawText(ctx, ann);
      break;
    case "highlight":
      drawHighlight(ctx, ann);
      break;
  }
  ctx.restore();
}

function drawArrow(ctx: CanvasRenderingContext2D, ann: ArrowAnnotation) {
  const { start, end } = ann;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const angle = Math.atan2(dy, dx);
  const headLen = Math.max(12, ann.strokeWidth * 4);

  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(
    end.x - headLen * Math.cos(angle - Math.PI / 6),
    end.y - headLen * Math.sin(angle - Math.PI / 6),
  );
  ctx.lineTo(
    end.x - headLen * Math.cos(angle + Math.PI / 6),
    end.y - headLen * Math.sin(angle + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fill();
}

function drawRectangle(ctx: CanvasRenderingContext2D, ann: RectangleAnnotation) {
  const { start, end } = ann;
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);
  ctx.strokeRect(x, y, w, h);
}

function drawFreehand(ctx: CanvasRenderingContext2D, ann: FreehandAnnotation) {
  if (ann.points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(ann.points[0].x, ann.points[0].y);
  for (let i = 1; i < ann.points.length; i++) {
    ctx.lineTo(ann.points[i].x, ann.points[i].y);
  }
  ctx.stroke();
}

function drawText(ctx: CanvasRenderingContext2D, ann: TextAnnotation) {
  ctx.font = `${ann.fontSize}px sans-serif`;
  ctx.textBaseline = "top";
  ctx.fillText(ann.text, ann.position.x, ann.position.y);
}

function drawHighlight(ctx: CanvasRenderingContext2D, ann: HighlightAnnotation) {
  if (ann.points.length < 2) return;
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = ann.color;
  ctx.lineWidth = ann.strokeWidth * 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(ann.points[0].x, ann.points[0].y);
  for (let i = 1; i < ann.points.length; i++) {
    ctx.lineTo(ann.points[i].x, ann.points[i].y);
  }
  ctx.stroke();
  ctx.restore();
}

export function renderAll(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  annotations: Annotation[],
) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.drawImage(image, 0, 0);
  for (const ann of annotations) {
    drawAnnotation(ctx, ann);
  }
}

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function getAnnotationBounds(ann: Annotation): BoundingBox {
  switch (ann.tool) {
    case "arrow":
    case "rectangle": {
      return {
        minX: Math.min(ann.start.x, ann.end.x),
        minY: Math.min(ann.start.y, ann.end.y),
        maxX: Math.max(ann.start.x, ann.end.x),
        maxY: Math.max(ann.start.y, ann.end.y),
      };
    }
    case "freehand":
    case "highlight": {
      if (ann.points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
      let minX = ann.points[0].x;
      let minY = ann.points[0].y;
      let maxX = ann.points[0].x;
      let maxY = ann.points[0].y;
      for (const p of ann.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      return { minX, minY, maxX, maxY };
    }
    case "text": {
      const width = ann.text.length * ann.fontSize * 0.55;
      const height = ann.fontSize;
      return {
        minX: ann.position.x,
        minY: ann.position.y,
        maxX: ann.position.x + width,
        maxY: ann.position.y + height,
      };
    }
    default: {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }
  }
}

export function hitTest(ann: Annotation, pt: Point): boolean {
  switch (ann.tool) {
    case "arrow": {
      return distanceToSegment(pt, ann.start, ann.end) <= Math.max(8, ann.strokeWidth + 4);
    }
    case "rectangle": {
      const minX = Math.min(ann.start.x, ann.end.x);
      const maxX = Math.max(ann.start.x, ann.end.x);
      const minY = Math.min(ann.start.y, ann.end.y);
      const maxY = Math.max(ann.start.y, ann.end.y);
      // Select if clicking borders or anywhere inside
      return pt.x >= minX - 4 && pt.x <= maxX + 4 && pt.y >= minY - 4 && pt.y <= maxY + 4;
    }
    case "freehand":
    case "highlight": {
      const isHighlight = ann.tool === "highlight";
      const threshold = Math.max(8, ann.strokeWidth * (isHighlight ? 3.5 : 1.5));
      for (let i = 0; i < ann.points.length - 1; i++) {
        if (distanceToSegment(pt, ann.points[i], ann.points[i + 1]) <= threshold) {
          return true;
        }
      }
      return false;
    }
    case "text": {
      const bounds = getAnnotationBounds(ann);
      return pt.x >= bounds.minX && pt.x <= bounds.maxX && pt.y >= bounds.minY && pt.y <= bounds.maxY;
    }
    default:
      return false;
  }
}

export function moveAnnotation(ann: Annotation, dx: number, dy: number): Annotation {
  switch (ann.tool) {
    case "arrow":
    case "rectangle": {
      return {
        ...ann,
        start: { x: ann.start.x + dx, y: ann.start.y + dy },
        end: { x: ann.end.x + dx, y: ann.end.y + dy },
      } as Annotation;
    }
    case "freehand":
    case "highlight": {
      return {
        ...ann,
        points: ann.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      } as Annotation;
    }
    case "text": {
      return {
        ...ann,
        position: { x: ann.position.x + dx, y: ann.position.y + dy },
      } as Annotation;
    }
    default:
      return ann;
  }
}

export interface ResizeHandle {
  id: string;
  x: number;
  y: number;
  cursor: string;
}

export function getResizeHandles(ann: Annotation): ResizeHandle[] {
  if (ann.tool === "arrow") {
    return [
      { id: "start", x: ann.start.x, y: ann.start.y, cursor: "move" },
      { id: "end", x: ann.end.x, y: ann.end.y, cursor: "move" },
    ];
  } else if (ann.tool === "rectangle") {
    const minX = Math.min(ann.start.x, ann.end.x);
    const maxX = Math.max(ann.start.x, ann.end.x);
    const minY = Math.min(ann.start.y, ann.end.y);
    const maxY = Math.max(ann.start.y, ann.end.y);
    return [
      { id: "nw", x: minX, y: minY, cursor: "nwse-resize" },
      { id: "ne", x: maxX, y: minY, cursor: "nesw-resize" },
      { id: "sw", x: minX, y: maxY, cursor: "nesw-resize" },
      { id: "se", x: maxX, y: maxY, cursor: "nwse-resize" },
    ];
  }
  return [];
}

export function hitTestHandle(ann: Annotation, pt: Point): ResizeHandle | null {
  const handles = getResizeHandles(ann);
  const size = 8;
  const threshold = size / 2 + 5; // Click margin
  for (const h of handles) {
    if (Math.hypot(pt.x - h.x, pt.y - h.y) <= threshold) {
      return h;
    }
  }
  return null;
}

export function resizeAnnotation(ann: Annotation, handleId: string, pt: Point): Annotation {
  if (ann.tool === "arrow") {
    if (handleId === "start") {
      return { ...ann, start: pt } as Annotation;
    } else if (handleId === "end") {
      return { ...ann, end: pt } as Annotation;
    }
  } else if (ann.tool === "rectangle") {
    const minX = Math.min(ann.start.x, ann.end.x);
    const maxX = Math.max(ann.start.x, ann.end.x);
    const minY = Math.min(ann.start.y, ann.end.y);
    const maxY = Math.max(ann.start.y, ann.end.y);
    
    if (handleId === "nw") {
      return { ...ann, start: pt, end: { x: maxX, y: maxY } } as Annotation;
    } else if (handleId === "se") {
      return { ...ann, start: { x: minX, y: minY }, end: pt } as Annotation;
    } else if (handleId === "ne") {
      return { ...ann, start: { x: minX, y: maxY }, end: { x: pt.x, y: pt.y } } as Annotation;
    } else if (handleId === "sw") {
      return { ...ann, start: { x: pt.x, y: pt.y }, end: { x: maxX, y: minY } } as Annotation;
    }
  }
  return ann;
}

export function drawSelectionIndicator(ctx: CanvasRenderingContext2D, ann: Annotation) {
  const bounds = getAnnotationBounds(ann);
  const padding = ann.tool === "text" || ann.tool === "freehand" || ann.tool === "highlight" ? 6 : 0;
  
  ctx.save();
  ctx.strokeStyle = "#3b82f6";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(
    bounds.minX - padding,
    bounds.minY - padding,
    (bounds.maxX - bounds.minX) + padding * 2,
    (bounds.maxY - bounds.minY) + padding * 2
  );
  
  // Draw resize handles
  const handles = getResizeHandles(ann);
  if (handles.length > 0) {
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#3b82f6";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    const size = 8;
    const half = size / 2;
    for (const h of handles) {
      ctx.fillRect(h.x - half, h.y - half, size, size);
      ctx.strokeRect(h.x - half, h.y - half, size, size);
    }
  }
  ctx.restore();
}
