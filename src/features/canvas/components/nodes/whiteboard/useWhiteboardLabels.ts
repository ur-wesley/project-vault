import { batch, createSignal } from "solid-js";

import type { WhiteboardElement, WhiteboardPoint } from "./types";
import { baseElement, createElementId, isBindableContainer } from "./types";
import type { ElementStylePatch } from "./types";
import { arrowPath, polylineMidpoint } from "./bindings";
import { insertWaypointAt, removeWaypointAt } from "./geometry";
import { getElementBounds, flattenSmoothPath } from "./geometry";
import {
  dedupeBoundTexts,
  growContainerForText,
  isInseparableLabel,
  linkBoundText,
  resolveBoundTextPosition,
  resolveGroupLabelPosition,
  snapLabelsToCenter,
} from "./boundText";
import { sanitizeTextWidth } from "./textMeasure";
import { groupBounds } from "./groups";
import type { WhiteboardStore } from "./useWhiteboardStore";

export const TEXT_FONT_SIZE = 16;
export const TEXT_MAX_CHARS = 2000;

function textDefaultsFromStyle(style: ElementStylePatch) {
  return {
    color: style.color ?? "#e5e5e5",
    strokeWidth: style.strokeWidth ?? 2,
    background: style.background ?? "transparent",
    fillColor: style.fillColor ?? "#3b82f6",
    strokeStyle: style.strokeStyle ?? "solid",
    opacity: style.opacity ?? 100,
    roundness: style.roundness ?? "round",
    fontSize: style.fontSize ?? TEXT_FONT_SIZE,
    fontFamily: style.fontFamily ?? "normal",
    textAlign: style.textAlign ?? "left",
    bold: style.bold ?? false,
    italic: style.italic ?? false,
  } as const;
}

export interface LabelEdit {
  containerId: string | null;
  groupId: string | null;
  textId: string | null;
  at: WhiteboardPoint;
  /** Fixed wrap width for drag-created free text; null = auto-width. */
  width: number | null;
}

export interface EditStyle {
  color: string;
  fontSize: number;
  fontFamily: "hand" | "normal" | "code";
  textAlign: "left" | "center" | "right";
  bold: boolean;
  italic: boolean;
}

/**
 * Text-label domain: label overlay state, double-click placement,
 * commit, group labels. Excalidraw-style: multiline textarea, Enter =
 * newline, Escape/blur commits, containers auto-grow, arrow labels on pills.
 */
export function useWhiteboardLabels(opts: {
  store: WhiteboardStore;
  toLocal: (e: PointerEvent | MouseEvent) => WhiteboardPoint;
  hasCanvas: () => boolean;
}) {
  const { store, toLocal, hasCanvas } = opts;
  const { elements, setElements, persist, activeStyle, setSelectedIds, setTool, commit, resolvedEnds, labelLayout } =
    store;

  const [labelEdit, setLabelEdit] = createSignal<LabelEdit | null>(null);
  const [textValue, setTextValue] = createSignal("");
  /** Style snapshot the edit overlay renders with: the edited label's own
   * style, or the text-tool defaults for brand-new labels. */
  const [editStyle, setEditStyle] = createSignal<EditStyle>({
    color: "#e5e5e5",
    fontSize: TEXT_FONT_SIZE,
    fontFamily: "normal",
    textAlign: "left",
    bold: false,
    italic: false,
  });

  const styleOfText = (el: WhiteboardElement): EditStyle => {
    if (el.kind === "text") {
      return {
        color: typeof el.color === "string" ? el.color : "#e5e5e5",
        fontSize: Number.isFinite(el.fontSize) ? el.fontSize : TEXT_FONT_SIZE,
        fontFamily: el.fontFamily === "hand" || el.fontFamily === "code" ? el.fontFamily : "normal",
        textAlign: el.textAlign === "center" || el.textAlign === "right" ? el.textAlign : "left",
        bold: el.bold === true,
        italic: el.italic === true,
      };
    }
    const td = textDefaultsFromStyle(activeStyle());
    return {
      color: td.color,
      fontSize: td.fontSize,
      fontFamily: td.fontFamily,
      textAlign: td.textAlign,
      bold: td.bold,
      italic: td.italic,
    };
  };

  const toolEditStyle = (): EditStyle => {
    const td = textDefaultsFromStyle(activeStyle());
    return {
      color: td.color,
      fontSize: td.fontSize,
      fontFamily: td.fontFamily,
      textAlign: td.textAlign,
      bold: td.bold,
      italic: td.italic,
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

  /** Anchor for a new bound-text edit: existing label position, else container center. */
  const boundAnchorFor = (
    container: WhiteboardElement | undefined,
    existing: WhiteboardElement | undefined,
    containerId: string,
    td: ReturnType<typeof textDefaultsFromStyle>,
    fallback: WhiteboardPoint,
  ): WhiteboardPoint => {
    if (existing) return labelLayout().anchors.get(existing.id) ?? fallback;
    if (!container) return fallback;
    return resolveBoundTextPosition(elements(), {
      ...baseElement("tmp", td.color, td.strokeWidth, td),
      kind: "text",
      position: { x: 0, y: 0 },
      text: "",
      fontSize: td.fontSize,
      fontFamily: td.fontFamily,
      bold: td.bold,
      italic: td.italic,
      containerId,
      labelGroupId: null,
      offset: { x: 0, y: 0 },
      width: null,
      textAlign: "center",
    });
  };

  const beginTextAt = (
    pt: WhiteboardPoint,
    width: number | null = null,
    containerId: string | null = null,
    textId: string | null = null,
  ) => {
    if (textId) {
      const target = elements().find((el) => el.id === textId && el.kind === "text");
      if (target && target.kind === "text") {
        const anchor =
          target.containerId || target.labelGroupId
            ? resolveBoundTextPosition(elements(), target)
            : target.position;
        openEdit(
          {
            containerId: target.containerId,
            groupId: target.labelGroupId,
            textId: target.id,
            at: anchor,
            width: target.width ?? null,
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
      if (container && (container.kind === "arrow" || container.kind === "line")) {
        const healed = dedupeBoundTexts(els, containerId);
        if (healed !== els) {
          commit(healed);
          els = healed;
        }
        const snapped = snapLabelsToCenter(els, containerId);
        if (snapped !== els) {
          setElements(snapped);
          persist(snapped);
          els = snapped;
        }
      }
      const existing = els.find(
        (el) => el.kind === "text" && el.containerId === containerId,
      );
      const anchor = boundAnchorFor(container, existing, containerId, td, pt);
      openEdit(
        { containerId, groupId: null, textId: existing?.id ?? null, at: anchor, width: null },
        existing && existing.kind === "text" ? existing.text : "",
        existing ? styleOfText(existing) : toolEditStyle(),
      );
      return;
    }
    openEdit(
      { containerId: null, groupId: null, textId: null, at: pt, width: w },
      "",
      toolEditStyle(),
    );
  };

  /** Fallback anchor: center of stored bounds (used when layout misses). */
  const fallbackPt = (hit: WhiteboardElement): WhiteboardPoint => {
    const b = getElementBounds(hit);
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  };

  const handleDoubleClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (!hasCanvas()) return;
    const pt = toLocal(e);
    const hit = store.hitAt(pt);
    if (!hit) {
      openEdit(
        { containerId: null, groupId: null, textId: null, at: pt, width: null },
        "",
        toolEditStyle(),
      );
      return;
    }
    if (hit.kind === "text") {
      // A stacked duplicate (several texts on one arrow) heals to the
      // survivor before opening, so only one text stays per arrow.
      let els = elements();
      let target = hit;
      if (hit.containerId) {
        const container = els.find((e) => e.id === hit.containerId);
        if (container && (container.kind === "arrow" || container.kind === "line")) {
          const healed = dedupeBoundTexts(els, hit.containerId);
          if (healed !== els) {
            commit(healed);
            els = healed;
          }
          const survivor = els.find(
            (el): el is Extract<WhiteboardElement, { kind: "text" }> =>
              el.kind === "text" && el.containerId === hit.containerId,
          );
          if (survivor) target = survivor;
          const snapped = snapLabelsToCenter(els, hit.containerId);
          if (snapped !== els) {
            setElements(snapped);
            persist(snapped);
            els = snapped;
            const centered = els.find(
              (el): el is Extract<WhiteboardElement, { kind: "text" }> => el.id === target.id,
            );
            if (centered) target = centered;
          }
        }
      }
      let anchor: WhiteboardPoint;
      if (target.containerId) anchor = resolveBoundTextPosition(els, target);
      else if (target.labelGroupId)
        anchor = labelLayout().anchors.get(target.id) ?? target.position;
      else anchor = target.position;
      openEdit(
        {
          containerId: target.containerId,
          groupId: target.labelGroupId,
          textId: target.id,
          at: anchor,
          width: target.width ?? null,
        },
        target.text,
        styleOfText(target),
      );
      return;
    }
    if (hit.kind === "arrow" || hit.kind === "line") {
      const els = elements();
      const path = arrowPath(els, hit);
      const painted = flattenSmoothPath(path);
      const resolved = resolvedEnds().get(hit.id) ?? { start: hit.start, end: hit.end };
      const z = store.zoom();
      // Double-click a bend point removes it (bend handles sit exactly on
      // the painted curve, so this always lines up with what you see).
      const wpIdx = path
        .slice(1, -1)
        .findIndex((p) => Math.hypot(p.x - pt.x, p.y - pt.y) <= 16 / z);
      if (wpIdx >= 0) {
        commit(
          els.map((el) =>
            el.id === hit.id && (el.kind === "arrow" || el.kind === "line")
              ? removeWaypointAt(el, wpIdx)
              : el,
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
            el.id === hit.id && (el.kind === "arrow" || el.kind === "line")
              ? insertWaypointAt(el, pt, resolved)
              : el,
          ),
        );
        setSelectedIds([hit.id]);
        return;
      }
    }
    if (isBindableContainer(hit)) {
      const td = textDefaultsFromStyle(activeStyle());
      // Connectors carry a single label: heal duplicates (keep first,
      // extras become free texts) before opening the survivor.
      let els = elements();
      if (hit.kind === "arrow" || hit.kind === "line") {
        const healed = dedupeBoundTexts(els, hit.id);
        if (healed !== els) {
          commit(healed);
          els = healed;
        }
        const snapped = snapLabelsToCenter(els, hit.id);
        if (snapped !== els) {
          setElements(snapped);
          persist(snapped);
          els = snapped;
        }
      }
      const existing = els.find((el) => el.kind === "text" && el.containerId === hit.id);
      // Single anchor source (same function render uses): midpoint for new
      // arrow labels, live anchor for existing ones.
      const anchor = existing
        ? resolveBoundTextPosition(els, existing)
        : resolveBoundTextPosition(els, {
            ...baseElement("tmp", td.color, td.strokeWidth, td),
            kind: "text",
            position: { x: 0, y: 0 },
            text: "",
            fontSize: td.fontSize,
            fontFamily: td.fontFamily,
            bold: td.bold,
            italic: td.italic,
            containerId: hit.id,
            labelGroupId: null,
            offset: { x: 0, y: 0 },
            width: null,
            textAlign: "center",
          });
      openEdit(
        {
          containerId: hit.id,
          groupId: null,
          textId: existing?.id ?? null,
          at: anchor,
          width: null,
        },
        existing && existing.kind === "text" ? existing.text : "",
        existing ? styleOfText(existing) : toolEditStyle(),
      );
    }
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
    const groupId = edit.groupId;
    const textId = edit.textId;
    if (!value) {
      // Empty commit deletes an existing label and unlinks it — except
      // inseparable arrow labels, which keep their text and just close.
      if (textId) {
        if (isInseparableLabel(elements(), textId)) {
          const target = elements().find((e) => e.id === textId);
          const cid =
            target && target.kind === "text" && target.containerId ? target.containerId : null;
          setTool("select");
          setSelectedIds(cid ? [cid] : []);
          return;
        }
        const els = elements().map((el) =>
          el.id === containerId && el.kind !== "text"
            ? {
                ...el,
                boundElements: el.boundElements.filter((b) => b.id !== textId),
              }
            : el,
        );
        commit(els.filter((el) => el.id !== textId));
        setSelectedIds([]);
      }
      setTool("select");
      return;
    }
    if (textId) {
      const next = elements().map((el) => {
        if (el.id === textId && el.kind === "text") {
          const updated = {
            ...el,
            text: value,
            width: el.containerId ? null : (edit.width ?? el.width ?? null),
          };
          // Arrow labels stay centered on the connector.
          if (isInseparableLabel(elements(), textId)) updated.offset = { x: 0, y: 0 };
          return updated;
        }
        return el;
      });
      // Bound edit may need its container to grow (Excalidraw behavior).
      const textEl = next.find((el) => el.id === textId);
      let grown = next;
      if (textEl && textEl.kind === "text" && textEl.containerId) {
        grown = next.map((el) =>
          el.id === textEl.containerId && el.kind !== "text"
            ? growContainerForText(el, { ...textEl, text: value })
            : el,
        );
      }
      commit(grown);
      revertToSelect([textId]);
    } else if (containerId) {
      // Single text per container: a bound text may have appeared since the
      // edit opened (sync echo, double open) — update it instead of doubling.
      const dupe = elements().find((el) => el.kind === "text" && el.containerId === containerId);
      if (dupe) {
        commit(
          elements().map((el) =>
            el.id === dupe.id && el.kind === "text" ? { ...el, text: value } : el,
          ),
        );
        revertToSelect([dupe.id]);
        return;
      }
      const id = createElementId();
      const td = textDefaultsFromStyle(activeStyle());
      const container = elements().find((e) => e.id === containerId);
      const onConnector =
        !!container && (container.kind === "arrow" || container.kind === "line");
      const nt: WhiteboardElement = {
        ...baseElement(id, td.color, td.strokeWidth, td),
        kind: "text",
        position: edit.at,
        text: value,
        fontSize: td.fontSize,
        fontFamily: onConnector ? "normal" : td.fontFamily,
        bold: onConnector ? false : td.bold,
        italic: onConnector ? false : td.italic,
        containerId,
        labelGroupId: null,
        offset: { x: 0, y: 0 },
        width: null,
        textAlign: "center",
      };
      if (onConnector && container && container.kind !== "text") {
        // Arrow labels inherit the connector's styling; only size is settable.
        (nt as Extract<WhiteboardElement, { kind: "text" }>).color = container.color;
        (nt as Extract<WhiteboardElement, { kind: "text" }>).opacity = container.opacity;
      } else if (container && td.color === "#e5e5e5" && container.color !== td.color) {
        // Bound-text font inheritance: keep container-linked color when the
        // text tool still holds its default stroke color.
        (nt as Extract<WhiteboardElement, { kind: "text" }>).color = container.color;
      }
      const withText = linkBoundText([...elements(), nt], containerId, id);
      const grown = withText.map((el) =>
        el.id === containerId && el.kind !== "text" ? growContainerForText(el, nt) : el,
      );
      commit(grown);
      revertToSelect([id]);
    } else if (groupId) {
      const id = createElementId();
      const td = textDefaultsFromStyle(activeStyle());
      const nt: WhiteboardElement = {
        ...baseElement(id, td.color, td.strokeWidth, td),
        kind: "text",
        position: edit.at,
        text: value,
        fontSize: td.fontSize,
        fontFamily: td.fontFamily,
        bold: td.bold,
        italic: td.italic,
        containerId: null,
        labelGroupId: groupId,
        offset: { x: 0, y: 0 },
        width: edit.width,
        textAlign: td.textAlign ?? "center",
      };
      commit([...elements(), nt]);
      revertToSelect([id]);
    } else {
      const id = createElementId();
      const td = textDefaultsFromStyle(activeStyle());
      commit([
        ...elements(),
        {
          ...baseElement(id, td.color, td.strokeWidth, td),
          kind: "text",
          position: edit.at,
          text: value,
          fontSize: td.fontSize,
          fontFamily: td.fontFamily,
          bold: td.bold,
          italic: td.italic,
          containerId: null,
          labelGroupId: null,
          offset: { x: 0, y: 0 },
          width: edit.width,
          textAlign: td.textAlign ?? "left",
        } as WhiteboardElement,
      ]);
      revertToSelect([id]);
    }
  };

  const openGroupLabel = () => {
    const g = store.selectedGroup();
    if (!g) return;
    const td = textDefaultsFromStyle(activeStyle());
    const els = elements();
    const existing = els.find((el) => el.kind === "text" && el.labelGroupId === g);
    const gb = groupBounds(els, g);
    const anchor = existing
      ? (labelLayout().anchors.get(existing.id) ?? fallbackPt(existing))
      : resolveGroupLabelPosition(gb, {
          ...baseElement("tmp", td.color, td.strokeWidth, td),
          kind: "text",
          position: { x: 0, y: 0 },
          text: "",
          fontSize: td.fontSize,
          fontFamily: td.fontFamily,
          bold: td.bold,
          italic: td.italic,
          containerId: null,
          labelGroupId: g,
          offset: { x: 0, y: 0 },
          width: null,
          textAlign: "center",
        });
    openEdit(
      {
        containerId: null,
        groupId: g,
        textId: existing?.id ?? null,
        at: anchor,
        width: existing && existing.kind === "text" ? (existing.width ?? null) : null,
      },
      existing && existing.kind === "text" ? existing.text : "",
      existing ? styleOfText(existing) : toolEditStyle(),
    );
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
    openGroupLabel,
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
