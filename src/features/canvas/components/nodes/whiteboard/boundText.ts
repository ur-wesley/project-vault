import type { ExcalidrawElement, ExcalidrawTextElement } from "./excalidrawTypes";
import type { WhiteboardPoint } from "./types";
import {
  getElementBounds,
  flattenSmoothPath,
  fontFamilyName,
  isConnector,
  isShapeElement,
  isTextElement,
  type BoundingBox,
} from "./geometry";
import { arrowPath, polylineMidpoint } from "./bindings";
import {
  LABEL_PILL_PAD_X,
  LABEL_PILL_PAD_Y,
  TEXT_PADDING_X,
  TEXT_PADDING_Y,
  boundWrapWidth,
  measureTextBlock,
} from "./textMeasure";

/**
 * Bound text on Excalidraw-native elements. Texts link via `containerId`
 * with `originalText` kept in sync; `groupIds` nesting is allowed (see
 * `./groups`); frame membership rides on `frameId`, and group labels are
 * frame names (see {@link frameLabel}).
 *
 * Bound labels render centered on their anchor (container center or
 * connector midpoint) — the stored `x/y` is derived, see
 * {@link syncBoundTextOrigins}. Direct label drags move the container.
 */

/** Quantize to half-px so sub-pixel midpoint drift doesn't flicker labels. */
function quantize(pt: WhiteboardPoint): WhiteboardPoint {
  return { x: Math.round(pt.x * 2) / 2, y: Math.round(pt.y * 2) / 2 };
}

/**
 * Derived render position of a bound text element: shape center or arrow
 * midpoint. Unbound text renders at its stored position.
 */
export function resolveBoundTextPosition(
  elements: ExcalidrawElement[],
  text: ExcalidrawTextElement,
): WhiteboardPoint {
  const base = boundTextAnchor(elements, text);
  if (!base) return { x: text.x, y: text.y };
  return quantize(base);
}

function boundTextAnchor(
  elements: ExcalidrawElement[],
  text: ExcalidrawTextElement,
): WhiteboardPoint | null {
  if (!text.containerId) return null;
  const container = elements.find((e) => e.id === text.containerId);
  if (!container) return null;
  if (isConnector(container)) {
    // Bent, curved or straight: label sits at the arc-length midpoint of
    // the painted curve.
    return polylineMidpoint(flattenSmoothPath(arrowPath(elements, container)));
  }
  if (isShapeElement(container)) {
    const b = getElementBounds(container);
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  }
  return null;
}

/**
 * Group-label → frame-name mapping: in the native model a group label is
 * the frame's name (frames group visually). Returns the frame name for a
 * frame id, or null when missing/unnamed.
 */
export function frameLabel(elements: ExcalidrawElement[], frameId: string): string | null {
  const frame = elements.find((e) => e.id === frameId);
  if (!frame || frame.type !== "frame") return null;
  return frame.name;
}

/** Link a text element to a container (adds both sides of the link). */
export function linkBoundText(
  elements: ExcalidrawElement[],
  containerId: string,
  textId: string,
): ExcalidrawElement[] {
  return elements.map((el) => {
    if (el.id === containerId && (isShapeElement(el) || isConnector(el))) {
      const bound = el.boundElements ?? [];
      if (bound.some((b) => b.id === textId)) return el;
      return { ...el, boundElements: [...bound, { type: "text" as const, id: textId }] };
    }
    if (el.id === textId && el.type === "text") {
      return {
        ...el,
        containerId,
        originalText: el.originalText ? el.originalText : el.text,
      };
    }
    return el;
  });
}

/**
 * Full id set removed when deleting `rootIds`: the roots, their bound
 * texts, arrows bound to any deleted element (cascade), and bound texts
 * of those arrows. Fixed-point iteration handles chains.
 */
export function cascadeDeleteIds(
  elements: ExcalidrawElement[],
  rootIds: Set<string>,
): Set<string> {
  const dead = new Set(rootIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const el of elements) {
      if (dead.has(el.id)) continue;
      if (isTextElement(el)) {
        if (el.containerId && dead.has(el.containerId)) {
          dead.add(el.id);
          changed = true;
          continue;
        }
      }
      if (isConnector(el)) {
        const startId = el.startBinding?.elementId;
        const endId = el.endBinding?.elementId;
        if ((startId && dead.has(startId)) || (endId && dead.has(endId))) {
          dead.add(el.id);
          changed = true;
        }
      }
    }
  }
  return dead;
}

/** Wrap width used for layout of a text element (null = auto-width). */
export function textWrapWidth(
  elements: ExcalidrawElement[],
  text: ExcalidrawTextElement,
): number | null {
  if (text.containerId) {
    const container = elements.find((e) => e.id === text.containerId);
    if (container && isShapeElement(container)) {
      const b = getElementBounds(container);
      return boundWrapWidth(b.maxX - b.minX);
    }
    // Arrow/line labels wrap to their own fixed width when set.
    return text.width > 0 ? text.width : 220;
  }
  return text.width > 0 ? text.width : null;
}

/** All texts bound to a container, in document order. */
export function boundTextsFor(
  elements: ExcalidrawElement[],
  containerId: string,
): ExcalidrawTextElement[] {
  return elements.filter(
    (el): el is ExcalidrawTextElement => isTextElement(el) && el.containerId === containerId,
  );
}

/**
 * Enforce a single bound text per container (arrows/lines): keep the first
 * in document order, convert extras to free texts at their current box so
 * no content is lost. Also repairs the container's boundElements links.
 * Returns the input array unchanged when there is nothing to heal.
 */
export function dedupeBoundTexts(
  elements: ExcalidrawElement[],
  containerId: string,
): ExcalidrawElement[] {
  const all = elements.filter(
    (el): el is ExcalidrawTextElement =>
      isTextElement(el) && el.containerId === containerId,
  );
  if (all.length <= 1) return elements;
  const extraIds = new Set(all.slice(1).map((el) => el.id));
  return elements.map((el) => {
    if (el.id === containerId && !isTextElement(el)) {
      const boundRefs = el.boundElements ?? [];
      return { ...el, boundElements: boundRefs.filter((b) => !extraIds.has(b.id)) };
    }
    if (extraIds.has(el.id) && isTextElement(el)) {
      const box = getTextBounds(elements, el);
      return { ...el, containerId: null, x: box.minX, y: box.minY };
    }
    return el;
  });
}

/**
 * True when the id is a label bound to an arrow/line: an inseparable part
 * of the connector, never selectable, movable, resizable, or deletable alone.
 */
export function isInseparableLabel(elements: ExcalidrawElement[], id: string): boolean {
  const el = elements.find((e) => e.id === id);
  if (!el || !isTextElement(el)) return false;
  if (!el.containerId) return false;
  const container = elements.find((e) => e.id === el.containerId);
  return !!container && isConnector(container);
}

/**
 * Resolve an arrow/line-bound label hit to its container, so pointer
 * selection, move, and erase treat the pair as one unit. Other hits pass
 * through (double-click and the text tool keep raw hit-testing for editing).
 */
export function redirectLabelHit(
  elements: ExcalidrawElement[],
  hit: ExcalidrawElement | null,
): ExcalidrawElement | null {
  if (!hit || !isTextElement(hit)) return hit;
  if (!hit.containerId) return hit;
  const container = elements.find((e) => e.id === hit.containerId);
  if (container && isConnector(container)) return container;
  return hit;
}

/** Drop inseparable labels from an id list (marquee hits, delete roots). */
export function excludeInseparableLabels(
  elements: ExcalidrawElement[],
  ids: readonly string[],
): string[] {
  return ids.filter((id) => !isInseparableLabel(elements, id));
}

function measureFor(text: ExcalidrawTextElement, wrap: number | null) {
  return measureTextBlock(text.text, text.fontSize, wrap, {
    fontFamily: fontFamilyName(text.fontFamily),
  });
}

/**
 * Selection/hit-test box for a text element. Bound texts are centered on
 * their anchor (matching render); free text uses its stored top-left box.
 * Uses the same wrapped layout as render so hit-box == visual.
 */
export function getTextBounds(
  elements: ExcalidrawElement[],
  text: ExcalidrawTextElement,
): BoundingBox {
  const wrap = textWrapWidth(elements, text);
  const block = measureFor(text, wrap);
  const isArrowLabel = (() => {
    if (!text.containerId) return false;
    const c = elements.find((e) => e.id === text.containerId);
    return !!c && isConnector(c);
  })();
  const padX = isArrowLabel ? LABEL_PILL_PAD_X : 0;
  const padY = isArrowLabel ? LABEL_PILL_PAD_Y : 0;
  const w = block.width + padX * 2;
  const h = block.height + padY * 2;
  if (text.containerId) {
    const c = resolveBoundTextPosition(elements, text);
    return { minX: c.x - w / 2, minY: c.y - h / 2, maxX: c.x + w / 2, maxY: c.y + h / 2 };
  }
  const fixedW = text.width;
  return {
    minX: text.x,
    minY: text.y,
    maxX: text.x + Math.max(w, fixedW > 0 ? fixedW : w),
    maxY: text.y + h,
  };
}

/**
 * Excalidraw-style container auto-grow: expand a shape so its bound text
 * fits inside with padding. Returns the resized container, or the original
 * when it already fits / target isn't a shape.
 */
export function growContainerForText(
  container: ExcalidrawElement,
  text: ExcalidrawTextElement,
): ExcalidrawElement {
  if (!isShapeElement(container)) return container;
  const box = getElementBounds(container);
  const wrap = boundWrapWidth(box.maxX - box.minX);
  const block = measureFor(text, wrap);
  const needW = block.width + TEXT_PADDING_X * 2;
  const needH = block.height + TEXT_PADDING_Y * 2;
  const curW = box.maxX - box.minX;
  const curH = box.maxY - box.minY;
  if (needW <= curW && needH <= curH) return container;
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const nextW = Math.max(curW, needW);
  const nextH = Math.max(curH, needH);
  return { ...container, x: cx - nextW / 2, y: cy - nextH / 2, width: nextW, height: nextH };
}

/**
 * Normalize stored `x/y` of bound texts to their anchor top-left (the
 * render position minus half the laid-out box). Bound labels are always
 * centered on their anchor in paint, hit-test, and selection — this keeps
 * the persisted scene identical to what's on screen, so exports open on
 * excalidraw.com exactly as painted here. Unbound texts and texts with a
 * missing container are untouched. Returns the input when nothing changes.
 */
export function syncBoundTextOrigins(elements: ExcalidrawElement[]): ExcalidrawElement[] {
  let changed = false;
  const next = elements.map((el) => {
    if (!isTextElement(el) || !el.containerId) return el;
    const box = getTextBounds(elements, el);
    if (box.minX === el.x && box.minY === el.y) return el;
    changed = true;
    return { ...el, x: box.minX, y: box.minY };
  });
  return changed ? next : elements;
}
