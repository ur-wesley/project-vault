import { batch, createSignal } from "solid-js";

import type { ExcalidrawElement, ExcalidrawTextElement } from "./excalidrawTypes";
import type { WhiteboardPoint } from "./types";
import { createElementId, newElement } from "./excalidrawDefaults";
import { arrowPath, polylineMidpoint } from "./bindings";
import { insertWaypointAt, removeWaypointAt } from "./geometryEdit";
import { flattenSmoothPath, isConnector, isShapeElement, isTextElement } from "./geometry";
import {
  dedupeBoundTexts,
  growContainerForText,
  isInseparableLabel,
  linkBoundText,
  resolveBoundTextPosition,
} from "./boundText";
import { sanitizeTextWidth } from "./textMeasure";
import { fontFamilyIdEx, fontFamilyNameEx, measureTextBlock } from "./textMeasure";
import type { FontName, StylePatch, TextAlignName } from "./whiteboardStyle";
import type { WhiteboardStore } from "./useWhiteboardStore";

export const TEXT_FONT_SIZE = 16;
export const TEXT_MAX_CHARS = 2000;

/** Typed text factory (newElement returns the wide union). */
function newText(patch: Record<string, unknown>): ExcalidrawTextElement {
  const el = newElement("text", patch);
  if (!isTextElement(el)) throw new Error("newText: text factory returned non-text");
  return el;
}

function textDefaultsFromStyle(style: StylePatch) {
  return {
    strokeColor: style.strokeColor ?? "#e5e5e5",
    strokeWidth: style.strokeWidth ?? 2,
    fontSize: style.fontSize ?? TEXT_FONT_SIZE,
    fontFamily: style.fontFamily ?? ("normal" as FontName),
    textAlign: style.textAlign ?? ("left" as TextAlignName),
  } as const;
}

export interface LabelEdit {
  containerId: string | null;
  textId: string | null;
  at: WhiteboardPoint;
  /** Fixed wrap width for drag-created free text; null = auto-width. */
  width: number | null;
}

export interface EditStyle {
  strokeColor: string;
  fontSize: number;
  fontFamily: FontName;
  textAlign: TextAlignName;
}

/**
 * Text-label domain: label overlay state, double-click placement,
 * commit. Excalidraw-style: multiline textarea, Enter =
 * newline, Escape/blur commits, containers auto-grow, arrow labels on pills.
 */
export function useWhiteboardLabels(opts: {
  store: WhiteboardStore;
  toLocal: (e: PointerEvent | MouseEvent) => WhiteboardPoint;
  hasCanvas: () => boolean;
}) {
  const { store, toLocal, hasCanvas } = opts;
  const { elements, activeStyle, setSelectedIds, setTool, commit, resolvedEnds, labelLayout } =
    store;

  const [labelEdit, setLabelEdit] = createSignal<LabelEdit | null>(null);
  const [textValue, setTextValue] = createSignal("");
  /** Style snapshot the edit overlay renders with: the edited label's own
   * style, or the text-tool defaults for brand-new labels. */
  const [editStyle, setEditStyle] = createSignal<EditStyle>({
    strokeColor: "#e5e5e5",
    fontSize: TEXT_FONT_SIZE,
    fontFamily: "normal",
    textAlign: "left",
  });

  const styleOfText = (el: ExcalidrawTextElement): EditStyle => ({
    strokeColor: typeof el.strokeColor === "string" ? el.strokeColor : "#e5e5e5",
    fontSize: Number.isFinite(el.fontSize) ? el.fontSize : TEXT_FONT_SIZE,
    fontFamily: fontFamilyNameEx(el.fontFamily),
    textAlign: el.textAlign === "center" || el.textAlign === "right" ? el.textAlign : "left",
  });

  const toolEditStyle = (): EditStyle => {
    const td = textDefaultsFromStyle(activeStyle());
    return {
      strokeColor: td.strokeColor,
      fontSize: td.fontSize,
      fontFamily: td.fontFamily,
      textAlign: td.textAlign,
    };
  };

  /**
   * Open the edit overlay. The three writes are batched so dependent
   * computations (overlay position/style, focus effect) observe a single
   * consistent state instead of mid-sequence partial values.
   */
  const openEdit = (edit: LabelEdit, text: string, style: EditStyle) => {
    batch(() => {
      setLabelEdit(edit);
      setTextValue(text);
      setEditStyle(style);
    });
  };

  /** Overlay wrap width for an existing text (null = auto-width). */
  const overlayWidthFor = (el: ExcalidrawTextElement): number | null =>
    el.autoResize ? null : el.width;

  /** Anchor for a new bound-text edit: existing label position, else container center. */
  const boundAnchorFor = (
    container: ExcalidrawElement | undefined,
    existing: ExcalidrawTextElement | undefined,
    containerId: string,
    td: ReturnType<typeof textDefaultsFromStyle>,
    fallback: WhiteboardPoint,
  ): WhiteboardPoint => {
    if (existing) return labelLayout().anchors.get(existing.id) ?? fallback;
    if (!container) return fallback;
    return resolveBoundTextPosition(
      elements(),
      newText({
        id: "tmp",
        x: 0,
        y: 0,
        strokeColor: td.strokeColor,
        fontSize: td.fontSize,
        fontFamily: fontFamilyIdEx(td.fontFamily),
        containerId,
      }),
    );
  };

  const beginTextAt = (
    pt: WhiteboardPoint,
    width: number | null = null,
    containerId: string | null = null,
    textId: string | null = null,
  ) => {
    if (textId) {
      const target = elements().find((el) => el.id === textId);
      if (target && isTextElement(target)) {
        const anchor = target.containerId
          ? resolveBoundTextPosition(elements(), target)
          : { x: target.x, y: target.y };
        openEdit(
          {
            containerId: target.containerId,
            textId: target.id,
            at: anchor,
            width: overlayWidthFor(target),
          },
          target.text,
          styleOfText(target),
        );
        return;
      }
    }
    const w = sanitizeTextWidth(width);
    const td = textDefaultsFromStyle(activeStyle());
    if (containerId) {
      let els = elements();
      const container = els.find((e) => e.id === containerId);
      if (container && isConnector(container)) {
        const healed = dedupeBoundTexts(els, containerId);
        if (healed !== els) {
          commit(healed);
          els = healed;
        }
      }
      const existing = els.find(
        (el): el is ExcalidrawTextElement =>
          isTextElement(el) && el.containerId === containerId,
      );
      const anchor = boundAnchorFor(container, existing, containerId, td, pt);
      openEdit(
        { containerId, textId: existing?.id ?? null, at: anchor, width: null },
        existing ? existing.text : "",
        existing ? styleOfText(existing) : toolEditStyle(),
      );
      return;
    }
    openEdit({ containerId: null, textId: null, at: pt, width: w }, "", toolEditStyle());
  };

  const handleDoubleClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (!hasCanvas()) return;
    const pt = toLocal(e);
    const hit = store.hitAt(pt);
    if (!hit) {
      openEdit({ containerId: null, textId: null, at: pt, width: null }, "", toolEditStyle());
      return;
    }
    if (isTextElement(hit)) {
      // A stacked duplicate (several texts on one arrow) heals to the
      // survivor before opening, so only one text stays per arrow.
      let els = elements();
      let target = hit;
      if (hit.containerId) {
        const container = els.find((e) => e.id === hit.containerId);
        if (container && isConnector(container)) {
          const healed = dedupeBoundTexts(els, hit.containerId);
          if (healed !== els) {
            commit(healed);
            els = healed;
          }
          const survivor = els.find(
            (el): el is ExcalidrawTextElement =>
              isTextElement(el) && el.containerId === hit.containerId,
          );
          if (survivor) target = survivor;
        }
      }
      const anchor = target.containerId
        ? resolveBoundTextPosition(els, target)
        : { x: target.x, y: target.y };
      openEdit(
        {
          containerId: target.containerId,
          textId: target.id,
          at: anchor,
          width: overlayWidthFor(target),
        },
        target.text,
        styleOfText(target),
      );
      return;
    }
    if (isConnector(hit)) {
      const els = elements();
      const path = arrowPath(els, hit);
      const painted = flattenSmoothPath(path);
      const resolved = resolvedEnds().get(hit.id) ?? connectorFallback(hit);
      const z = store.zoom();
      // Double-click a bend point removes it (bend handles sit exactly on
      // the painted curve, so this always lines up with what you see).
      const wpIdx = path
        .slice(1, -1)
        .findIndex((p) => Math.hypot(p.x - pt.x, p.y - pt.y) <= 16 / z);
      if (wpIdx >= 0) {
        commit(
          els.map((el) =>
            el.id === hit.id && isConnector(el) ? removeWaypointAt(el, wpIdx) : el,
          ),
        );
        setSelectedIds([hit.id]);
        return;
      }
      const mid = polylineMidpoint(painted);
      // Near the painted midpoint preserves the arrow-label flow; anywhere
      // else on the connector adds a bend point that stays on the curve
      // (the interpolating curve passes through every waypoint).
      if (Math.hypot(mid.x - pt.x, mid.y - pt.y) > 18 / z) {
        commit(
          els.map((el) =>
            el.id === hit.id && isConnector(el) ? insertWaypointAt(el, pt, resolved) : el,
          ),
        );
        setSelectedIds([hit.id]);
        return;
      }
    }
    if (isShapeElement(hit) || isConnector(hit)) {
      const td = textDefaultsFromStyle(activeStyle());
      // Connectors carry a single label: heal duplicates (keep first,
      // extras become free texts) before opening the survivor.
      let els = elements();
      if (isConnector(hit)) {
        const healed = dedupeBoundTexts(els, hit.id);
        if (healed !== els) {
          commit(healed);
          els = healed;
        }
      }
      const existing = els.find(
        (el): el is ExcalidrawTextElement => isTextElement(el) && el.containerId === hit.id,
      );
      // Single anchor source (same function render uses): midpoint for new
      // arrow labels, live anchor for existing ones.
      const anchor = existing
        ? resolveBoundTextPosition(els, existing)
        : resolveBoundTextPosition(
            els,
            newText({
              id: "tmp",
              x: 0,
              y: 0,
              strokeColor: td.strokeColor,
              fontSize: td.fontSize,
              fontFamily: fontFamilyIdEx(td.fontFamily),
              containerId: hit.id,
            }),
          );
      openEdit(
        {
          containerId: hit.id,
          textId: existing?.id ?? null,
          at: anchor,
          width: null,
        },
        existing ? existing.text : "",
        existing ? styleOfText(existing) : toolEditStyle(),
      );
    }
  };

  const connectorFallback = (
    hit: ExcalidrawElement,
  ): { start: WhiteboardPoint; end: WhiteboardPoint } => {
    if (isConnector(hit)) {
      const pts = hit.points.map(([px, py]) => ({ x: hit.x + px, y: hit.y + py }));
      const first = pts[0] ?? { x: hit.x, y: hit.y };
      const last = pts[pts.length - 1] ?? { x: hit.x, y: hit.y };
      return { start: first, end: last };
    }
    return { start: { x: 0, y: 0 }, end: { x: 0, y: 0 } };
  };

  /** Excalidraw commit: keep interior newlines, drop trailing blank lines. */
  function normalizeCommit(raw: string): string {
    const cleaned = raw.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n");
    // Keep leading indentation on first line trimmed like Excalidraw, but
    // preserve interior empty lines; drop trailing empty lines.
    const lines = cleaned.split("\n");
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
    while (lines.length > 0 && lines[0].trim() === "") lines.shift();
    return lines.join("\n").slice(0, TEXT_MAX_CHARS);
  }

  const commitLabel = () => {
    const edit = labelEdit();
    const raw = textValue();
    const value = normalizeCommit(raw);
    batch(() => {
      setLabelEdit(null);
      setTextValue("");
    });
    if (!edit) return;
    const containerId = edit.containerId;
    const textId = edit.textId;
    if (!value) {
      // Empty commit deletes an existing label and unlinks it — except
      // inseparable arrow labels, which keep their text and just close.
      if (textId) {
        if (isInseparableLabel(elements(), textId)) {
          const target = elements().find((e) => e.id === textId);
          const cid = target && isTextElement(target) ? target.containerId : null;
          setTool("select");
          setSelectedIds(cid ? [cid] : []);
          return;
        }
        const els = elements().map((el) =>
          el.id !== containerId || isTextElement(el)
            ? el
            : { ...el, boundElements: (el.boundElements ?? []).filter((b) => b.id !== textId) },
        );
        commit(els.filter((el) => el.id !== textId));
        setSelectedIds([]);
      }
      setTool("select");
      return;
    }
    if (textId) {
      const next = elements().map((el) => {
        if (el.id === textId && isTextElement(el)) {
          // Every commit writes `text` + `originalText` together;
          // drag-width free texts stay fixed (`autoResize: false`).
          const free = !el.containerId;
          const width = free ? (edit.width ?? el.width) : el.width;
          const autoResize = free ? edit.width == null && el.autoResize : true;
          return { ...el, text: value, originalText: value, width, autoResize };
        }
        return el;
      });
      // Bound edit may need its container to grow (Excalidraw behavior).
      const textEl = next.find((el) => el.id === textId);
      let grown = next;
      if (textEl && isTextElement(textEl) && textEl.containerId) {
        grown = next.map((el) =>
          el.id === textEl.containerId && !isTextElement(el)
            ? growContainerForText(el, { ...textEl, text: value })
            : el,
        );
      }
      commit(grown);
      revertToSelect([textId]);
    } else if (containerId) {
      // Single text per container: a bound text may have appeared since the
      // edit opened (sync echo, double open) — update it instead of doubling.
      const dupe = elements().find(
        (el): el is ExcalidrawTextElement => isTextElement(el) && el.containerId === containerId,
      );
      if (dupe) {
        commit(
          elements().map((el) =>
            el.id === dupe.id && isTextElement(el)
              ? { ...el, text: value, originalText: value }
              : el,
          ),
        );
        revertToSelect([dupe.id]);
        return;
      }
      const id = createElementId();
      const td = textDefaultsFromStyle(activeStyle());
      const container = elements().find((e) => e.id === containerId);
      const onConnector = !!container && isConnector(container);
      const strokeColor =
        onConnector && container && !isTextElement(container)
          ? container.strokeColor
          : td.strokeColor;
      const nt = newText({
        id,
        x: Math.round(edit.at.x),
        y: Math.round(edit.at.y),
        strokeColor,
        fontSize: td.fontSize,
        fontFamily: onConnector ? 2 : fontFamilyIdEx(td.fontFamily),
        textAlign: "center",
        text: value,
        originalText: value,
        containerId,
        autoResize: true,
      });
      const withText = linkBoundText([...elements(), nt], containerId, id);
      const grown = withText.map((el) =>
        el.id === containerId && !isTextElement(el) && isTextElement(nt)
          ? growContainerForText(el, nt)
          : el,
      );
      commit(grown);
      revertToSelect([id]);
    } else {
      const id = createElementId();
      const td = textDefaultsFromStyle(activeStyle());
      const block = measureTextBlock(value, td.fontSize, edit.width ?? null, {
        fontFamily: fontFamilyIdEx(td.fontFamily),
      });
      const nt = newText({
        id,
        x: Math.round(edit.at.x),
        y: Math.round(edit.at.y),
        width: Math.max(block.width, edit.width ?? block.width),
        height: block.height,
        strokeColor: td.strokeColor,
        fontSize: td.fontSize,
        fontFamily: fontFamilyIdEx(td.fontFamily),
        textAlign: td.textAlign,
        text: value,
        originalText: value,
        autoResize: edit.width == null,
      });
      commit([...elements(), nt]);
      revertToSelect([id]);
    }
  };

  const revertToSelect = (select: string[]) => {
    setTool("select");
    setSelectedIds(select);
  };

  // Focus the overlay textarea whenever an edit session starts.
  let textInputRef: HTMLTextAreaElement | undefined;

  return {
    labelEdit,
    textValue,
    setTextValue,
    setLabelEdit,
    editStyle,
    beginTextAt,
    handleDoubleClick,
    commitLabel,
    setTextInputRef: (el: HTMLTextAreaElement | undefined) => {
      textInputRef = el;
    },
    focusTextInput: () => {
      if (labelEdit() && textInputRef) {
        textInputRef.focus();
        // Place caret at end for edits, select-all for fresh bound labels.
        const len = textInputRef.value.length;
        try {
          textInputRef.setSelectionRange(len, len);
        } catch {
          textInputRef.select();
        }
      }
    },
  };
}

export type WhiteboardLabels = ReturnType<typeof useWhiteboardLabels>;
