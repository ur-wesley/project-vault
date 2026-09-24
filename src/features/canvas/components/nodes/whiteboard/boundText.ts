import type { WhiteboardElement, WhiteboardPoint } from "./types";
import { getElementBounds, flattenSmoothPath, type BoundingBox } from "./geometry";
import { arrowPath, polylineMidpoint } from "./bindings";
import { groupBounds } from "./groups";
import {
  LABEL_PILL_PAD_X,
  LABEL_PILL_PAD_Y,
  TEXT_PADDING_X,
  TEXT_PADDING_Y,
  boundWrapWidth,
  measureTextBlock,
} from "./textMeasure";

/** Quantize to half-px so sub-pixel midpoint drift doesn't flicker labels. */
function quantize(pt: WhiteboardPoint): WhiteboardPoint {
  return { x: Math.round(pt.x * 2) / 2, y: Math.round(pt.y * 2) / 2 };
}

/**
 * Derived render position of a bound text element: shape center or arrow
 * midpoint, plus the user-draggable offset. Unbound text renders at its
 * stored position.
 */
export function resolveBoundTextPosition(
  elements: WhiteboardElement[],
  text: Extract<WhiteboardElement, { kind: "text" }>,
): WhiteboardPoint {
  const base = boundTextAnchor(elements, text);
  if (!base) return text.position;
  return quantize({ x: base.x + text.offset.x, y: base.y + text.offset.y });
}

function boundTextAnchor(
  elements: WhiteboardElement[],
  text: Extract<WhiteboardElement, { kind: "text" }>,
): WhiteboardPoint | null {
  if (text.containerId) {
    const container = elements.find((e) => e.id === text.containerId);
    if (!container) return null;
    if (container.kind === "arrow" || container.kind === "line") {
      // Bent, curved or straight: label sits at the arc-length midpoint of
      // the painted curve.
      return polylineMidpoint(flattenSmoothPath(arrowPath(elements, container)));
    }
    if (
      container.kind === "rectangle" ||
      container.kind === "ellipse" ||
      container.kind === "diamond"
    ) {
      const b = getElementBounds(container);
      return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    }
    return null;
  }
  return null;
}

/** Render position of a group label: top-center above the union bounds. */
export function groupLabelAnchor(groupBox: BoundingBox): WhiteboardPoint {
  return { x: (groupBox.minX + groupBox.maxX) / 2, y: groupBox.minY };
}

export function resolveGroupLabelPosition(
  groupBox: BoundingBox | null,
  text: Extract<WhiteboardElement, { kind: "text" }>,
): WhiteboardPoint {
  if (!groupBox) return text.position;
  const anchor = groupLabelAnchor(groupBox);
  return quantize({ x: anchor.x + text.offset.x, y: anchor.y + text.offset.y - 8 });
}

/** Link a text element to a container (adds both sides of the link). */
export function linkBoundText(
  elements: WhiteboardElement[],
  containerId: string,
  textId: string,
): WhiteboardElement[] {
  return elements.map((el) => {
    if (
      el.id === containerId &&
      (el.kind === "rectangle" ||
        el.kind === "ellipse" ||
        el.kind === "diamond" ||
        el.kind === "arrow" ||
        el.kind === "line")
    ) {
      if (el.boundElements.some((b) => b.id === textId)) return el;
      return { ...el, boundElements: [...el.boundElements, { type: "text" as const, id: textId }] };
    }
    if (el.id === textId && el.kind === "text") {
      return { ...el, containerId };
    }
    return el;
  });
}

/**
 * Full id set removed when deleting `rootIds`: the roots, their bound
 * texts, arrows bound to any deleted element (cascade), and bound texts
 * of those arrows. Fixed-point iteration handles chains.
 */
export function cascadeDeleteIds(elements: WhiteboardElement[], rootIds: Set<string>): Set<string> {
  const dead = new Set(rootIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const el of elements) {
      if (dead.has(el.id)) continue;
      if (el.kind === "text" && el.containerId && dead.has(el.containerId)) {
        dead.add(el.id);
        changed = true;
        continue;
      }
      if (el.kind === "arrow" || el.kind === "line") {
        if (
          (el.startBinding && dead.has(el.startBinding.elementId)) ||
          (el.endBinding && dead.has(el.endBinding.elementId))
        ) {
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
  elements: WhiteboardElement[],
  text: Extract<WhiteboardElement, { kind: "text" }>,
): number | null {
  if (text.containerId) {
    const container = elements.find((e) => e.id === text.containerId);
    if (
      container &&
      (container.kind === "rectangle" ||
        container.kind === "ellipse" ||
        container.kind === "diamond")
    ) {
      const b = getElementBounds(container);
      return boundWrapWidth(b.maxX - b.minX);
    }
    // Arrow/line labels + group labels wrap to their own fixed width when set.
    return text.width ?? 220;
  }
  if (text.labelGroupId) return text.width ?? 220;
  return text.width;
}

/**
 * All texts bound to a container, in document order.
 */
export function boundTextsFor(  elements: WhiteboardElement[],
  containerId: string,
): Extract<WhiteboardElement, { kind: "text" }>[] {
  return elements.filter(
    (el): el is Extract<WhiteboardElement, { kind: "text" }> =>
      el.kind === "text" && el.containerId === containerId,
  );
}

/**
 * Enforce a single bound text per container (arrows/lines): keep the first
 * in document order, convert extras to free texts at their current box so
 * no content is lost. Also repairs the container's boundElements links.
 * Returns the input array unchanged when there is nothing to heal.
 */
export function dedupeBoundTexts(
  elements: WhiteboardElement[],
  containerId: string,
): WhiteboardElement[] {
  const bound = boundTextsFor(elements, containerId);
  if (bound.length <= 1) return elements;
  const extraIds = new Set(bound.slice(1).map((el) => el.id));
  return elements.map((el) => {
    if (el.id === containerId && el.kind !== "text") {
      return {
        ...el,
        boundElements: el.boundElements.filter((b) => !extraIds.has(b.id)),
      };
    }
    if (extraIds.has(el.id) && el.kind === "text") {
      const box = getTextBounds(elements, el);
      return {
        ...el,
        containerId: null,
        offset: { x: 0, y: 0 },
        position: { x: box.minX, y: box.minY },
        width: null,
        textAlign: "left" as const,
      };
    }
    return el;
  });
}

/**
 * True when the id is a label bound to an arrow/line: an inseparable part
 * of the connector, never selectable, movable, resizable, or deletable alone.
 */
export function isInseparableLabel(elements: WhiteboardElement[], id: string): boolean {
  const el = elements.find((e) => e.id === id);
  if (!el || el.kind !== "text" || !el.containerId) return false;
  const container = elements.find((e) => e.id === el.containerId);
  return !!container && (container.kind === "arrow" || container.kind === "line");
}

/**
 * Resolve an arrow/line-bound label hit to its container, so pointer
 * selection, move, and erase treat the pair as one unit. Other hits pass
 * through (double-click and the text tool keep raw hit-testing for editing).
 */
export function redirectLabelHit(
  elements: WhiteboardElement[],
  hit: WhiteboardElement | null,
): WhiteboardElement | null {
  if (!hit || hit.kind !== "text" || !hit.containerId) return hit;
  const container = elements.find((e) => e.id === hit.containerId);
  if (container && (container.kind === "arrow" || container.kind === "line")) return container;
  return hit;
}

/** Drop inseparable labels from an id list (marquee hits, delete roots). */
export function excludeInseparableLabels(
  elements: WhiteboardElement[],
  ids: readonly string[],
): string[] {
  return ids.filter((id) => !isInseparableLabel(elements, id));
}

/**
 * Snap arrow/line-bound texts back to the connector center (zero offset).
 * Returns the input array unchanged when already centered.
 */
export function snapLabelsToCenter(
  elements: WhiteboardElement[],
  containerId: string,
): WhiteboardElement[] {
  let changed = false;
  const next = elements.map((el) => {
    if (
      el.kind === "text" &&
      el.containerId === containerId &&
      (el.offset.x !== 0 || el.offset.y !== 0)
    ) {
      changed = true;
      return { ...el, offset: { x: 0, y: 0 } };
    }
    return el;
  });
  return changed ? next : elements;
}

/**
 * Selection/hit-test box for a text element. Bound texts are centered on
 * their anchor (matching render); free text uses its stored top-left box.
 * Uses the same wrapped layout as render so hit-box == visual.
 */
export function getTextBounds(
  elements: WhiteboardElement[],
  text: Extract<WhiteboardElement, { kind: "text" }>,
): BoundingBox {
  const wrap = textWrapWidth(elements, text);
  const block = measureTextBlock(text.text, text.fontSize, wrap, {
    bold: text.bold,
    fontFamily: text.fontFamily,
  });
  const isArrowLabel = (() => {
    if (!text.containerId) return false;
    const c = elements.find((e) => e.id === text.containerId);
    return !!c && (c.kind === "arrow" || c.kind === "line");
  })();
  const padX = isArrowLabel ? LABEL_PILL_PAD_X : 0;
  const padY = isArrowLabel ? LABEL_PILL_PAD_Y : 0;
  const w = block.width + padX * 2;
  const h = block.height + padY * 2;
  if (text.containerId) {
    const c = resolveBoundTextPosition(elements, text);
    return { minX: c.x - w / 2, minY: c.y - h / 2, maxX: c.x + w / 2, maxY: c.y + h / 2 };
  }
  if (text.labelGroupId) {
    const gb = groupBounds(elements, text.labelGroupId);
    const c = resolveGroupLabelPosition(gb, text);
    return { minX: c.x - w / 2, minY: c.y - h / 2, maxX: c.x + w / 2, maxY: c.y + h / 2 };
  }
  return {
    minX: text.position.x,
    minY: text.position.y,
    maxX: text.position.x + Math.max(w, text.width ?? w),
    maxY: text.position.y + h,
  };
}

/**
 * Excalidraw-style container auto-grow: expand a shape so its bound text
 * fits inside with padding. Returns the resized container, or the original
 * when it already fits / target isn't a shape.
 */
export function growContainerForText(
  container: WhiteboardElement,
  text: Extract<WhiteboardElement, { kind: "text" }>,
): WhiteboardElement {
  if (
    container.kind !== "rectangle" &&
    container.kind !== "ellipse" &&
    container.kind !== "diamond"
  ) {
    return container;
  }
  const box = getElementBounds(container);
  const wrap = boundWrapWidth(box.maxX - box.minX);
  const block = measureTextBlock(text.text, text.fontSize, wrap, {
    bold: text.bold,
    fontFamily: text.fontFamily,
  });
  const needW = block.width + TEXT_PADDING_X * 2;
  const needH = block.height + TEXT_PADDING_Y * 2;
  const curW = box.maxX - box.minX;
  const curH = box.maxY - box.minY;
  if (needW <= curW && needH <= curH) return container;
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const nextW = Math.max(curW, needW);
  const nextH = Math.max(curH, needH);
  return {
    ...container,
    start: { x: cx - nextW / 2, y: cy - nextH / 2 },
    end: { x: cx + nextW / 2, y: cy + nextH / 2 },
  };
}
