import { createMemo, createSignal } from "solid-js";

import type { ExcalidrawElement } from "./excalidrawTypes";
import type { WhiteboardTool } from "./types";
import type { ExcalidrawFillStyle } from "./colors";
import {
  applyStylePatch,
  defaultStyleFor,
  expandPatchAuto,
  propagateConnectorStyle,
  scopePatchForSelection,
  selectionStyleFor,
  type ArrowheadName,
  type FontName,
  type RoundnessName,
  type StylePatch,
  type TextAlignName,
} from "./whiteboardStyle";
import { autoTintFor } from "./whiteboardStyle";

/**
 * Board style state: per-signal tool style, per-tool memory (Excalidraw
 * behavior — switching tools restores each tool's last style),
 * selection-aware editing with single-undo live gestures, and the
 * auto-follow background tint. The store owns elements/history/persist;
 * this hook owns everything style and re-exports it for the toolbar.
 */
export function useWhiteboardStyle(opts: {
  tool: () => WhiteboardTool;
  elements: () => ExcalidrawElement[];
  selectedIds: () => string[];
  pushHistory: () => void;
  setElements: (fn: (els: ExcalidrawElement[]) => ExcalidrawElement[]) => void;
  persist: (els: ExcalidrawElement[]) => void;
}) {
  const { tool, elements, selectedIds, pushHistory, setElements, persist } = opts;

  const [strokeColor, setStrokeColorSignal] = createSignal("#e5e5e5");
  const [strokeWidth, setStrokeWidthSignal] = createSignal(2);
  const [fillStyle, setFillStyleSignal] = createSignal<ExcalidrawFillStyle>("transparent");
  const [backgroundColor, setBackgroundColorSignal] = createSignal("#3b82f6");
  const [strokeStyle, setStrokeStyleSignal] = createSignal<"solid" | "dashed" | "dotted">("solid");
  const [opacity, setOpacitySignal] = createSignal(100);
  const [roundness, setRoundnessSignal] = createSignal<RoundnessName>("round");
  const [fontSize, setFontSizeSignal] = createSignal(16);
  const [fontFamily, setFontFamilySignal] = createSignal<FontName>("normal");
  const [textAlign, setTextAlignSignal] = createSignal<TextAlignName>("left");
  const [startArrowhead, setStartArrowSignal] = createSignal<ArrowheadName>("none");
  const [endArrowhead, setEndArrowSignal] = createSignal<ArrowheadName>("arrow");

  /** Per-tool remembered style (Excalidraw behavior). */
  const [styleByTool, setStyleByTool] = createSignal<Record<string, StylePatch>>({
    freehand: defaultStyleFor("freehand"),
    rectangle: defaultStyleFor("rectangle"),
    ellipse: defaultStyleFor("ellipse"),
    diamond: defaultStyleFor("diamond"),
    arrow: defaultStyleFor("arrow"),
    line: defaultStyleFor("line"),
    text: defaultStyleFor("text"),
  });

  const [roughnessSig, setRoughnessSignal] = createSignal<0 | 1 | 2>(1);
  const roughness = () => roughnessSig();

  const snapshotGlobals = (): StylePatch => ({
    strokeColor: strokeColor(),
    strokeWidth: strokeWidth(),
    fillStyle: fillStyle(),
    backgroundColor: backgroundColor(),
    strokeStyle: strokeStyle(),
    opacity: opacity(),
    roundness: roundness(),
    roughness: roughness(),
    fontSize: fontSize(),
    fontFamily: fontFamily(),
    textAlign: textAlign(),
    startArrowhead: startArrowhead(),
    endArrowhead: endArrowhead(),
  });

  const loadGlobals = (p: StylePatch) => {
    if (p.strokeColor !== undefined) setStrokeColorSignal(p.strokeColor);
    if (p.strokeWidth !== undefined) setStrokeWidthSignal(p.strokeWidth);
    if (p.fillStyle !== undefined) setFillStyleSignal(p.fillStyle);
    if (p.backgroundColor !== undefined) setBackgroundColorSignal(p.backgroundColor);
    if (p.strokeStyle !== undefined) setStrokeStyleSignal(p.strokeStyle);
    if (p.opacity !== undefined) setOpacitySignal(p.opacity);
    if (p.roundness !== undefined) setRoundnessSignal(p.roundness);
    if (p.roughness !== undefined) setRoughnessSignal(p.roughness);
    if (p.fontSize !== undefined) setFontSizeSignal(p.fontSize);
    if (p.fontFamily !== undefined) setFontFamilySignal(p.fontFamily);
    if (p.textAlign !== undefined) setTextAlignSignal(p.textAlign);
    if (p.startArrowhead !== undefined) setStartArrowSignal(p.startArrowhead);
    if (p.endArrowhead !== undefined) setEndArrowSignal(p.endArrowhead);
  };

  /** Tool-switch memory: stash the outgoing style, restore the incoming one. */
  const onToolSwitch = (prev: WhiteboardTool, next: WhiteboardTool) => {
    setStyleByTool((m) => ({ ...m, [prev]: { ...m[prev], ...snapshotGlobals() } }));
    const remembered = styleByTool()[next];
    if (remembered) loadGlobals(remembered);
  };

  // ---- Selection-aware style editing (single-undo live gestures) ----

  /** True while a continuous style gesture (slider/color drag) is open. */
  let styleGestureOpen = false;

  /** Active style for the toolbar: selection merge wins, else current tool default. */
  const activeStyle = createMemo((): StylePatch => {
    const sel = selectionStyleFor(elements(), selectedIds());
    if (selectedIds().length > 0) return { ...snapshotGlobals(), ...sel };
    return snapshotGlobals();
  });

  const selectionStyle = createMemo((): StylePatch => selectionStyleFor(elements(), selectedIds()));

  const rememberForTool = (patch: StylePatch) => {
    const t = tool();
    setStyleByTool((m) => ({ ...m, [t]: { ...m[t], ...patch } }));
  };

  /**
   * Auto-follow fills (Excalidraw-like): while a tool's fill is still
   * automatic, changing its stroke color derives a lighter background tint.
   * Picking any fill manually locks that tool to manual mode.
   */
  const [fillAutoByTool, setFillAutoByTool] = createSignal<Record<string, boolean>>({
    freehand: true,
    rectangle: true,
    ellipse: true,
    diamond: true,
    arrow: true,
    line: true,
    text: true,
  });

  const isFillAuto = (): boolean => fillAutoByTool()[tool()] !== false;

  const expandPatch = (patch: StylePatch): StylePatch => {
    const t = tool();
    if (patch.backgroundColor !== undefined) {
      if (fillAutoByTool()[t] !== false) setFillAutoByTool((m) => ({ ...m, [t]: false }));
      return patch;
    }
    return expandPatchAuto(patch, fillAutoByTool()[t] !== false);
  };

  /** Re-enable auto fill for the current tool, snapping to the derived tint. */
  const resetFillAuto = () => {
    const t = tool();
    setFillAutoByTool((m) => ({ ...m, [t]: true }));
    const tint = autoTintFor(strokeColor());
    commitStyle({ backgroundColor: tint });
    setFillAutoByTool((m) => ({ ...m, [t]: true }));
  };

  /** Discrete style change (button click): one history entry. Restyles selection if any. */
  const commitStyle = (patch: StylePatch) => {
    const ids = selectedIds();
    const scoped = scopePatchForSelection(elements(), ids, patch);
    const full = expandPatch(scoped);
    loadGlobals(full);
    rememberForTool(full);
    if (ids.length === 0) return;
    const set = new Set(ids);
    pushHistory();
    const next = propagateConnectorStyle(
      elements().map((el) => (set.has(el.id) ? applyStylePatch(el, full) : el)),
      ids,
      full,
    );
    setElements(() => next);
    persist(next);
  };

  /** Open a continuous gesture (slider/drag): pushes exactly one history entry. */
  const beginStyleGesture = () => {
    if (styleGestureOpen) return;
    if (selectedIds().length > 0) pushHistory();
    styleGestureOpen = true;
  };

  /** Live update inside an open gesture: no new history entries. */
  const liveStyle = (patch: StylePatch) => {
    const ids = selectedIds();
    const scoped = scopePatchForSelection(elements(), ids, patch);
    const full = expandPatch(scoped);
    loadGlobals(full);
    rememberForTool(full);
    if (ids.length === 0) return;
    const set = new Set(ids);
    setElements((els) =>
      propagateConnectorStyle(
        els.map((el) => (set.has(el.id) ? applyStylePatch(el, full) : el)),
        ids,
        full,
      ),
    );
  };

  const endStyleGesture = () => {
    if (!styleGestureOpen) return;
    styleGestureOpen = false;
    persist(elements());
  };

  // Style setters route through the style system so per-tool memory +
  // selection restyle keep working for all callers.
  const setStrokeColor = (c: string) => commitStyle({ strokeColor: c });
  const setStrokeWidth = (w: number) => commitStyle({ strokeWidth: w });
  const setFillStyle = (v: ExcalidrawFillStyle) => commitStyle({ fillStyle: v });
  const setBackgroundColor = (v: string) => commitStyle({ backgroundColor: v });
  const setStrokeStyle = (v: "solid" | "dashed" | "dotted") => commitStyle({ strokeStyle: v });
  const setOpacity = (v: number) => commitStyle({ opacity: v });
  const setRoundness = (v: RoundnessName) => commitStyle({ roundness: v });
  const setRoughness = (v: 0 | 1 | 2) => commitStyle({ roughness: v });
  const setFontSize = (v: number) => commitStyle({ fontSize: v });
  const setFontFamily = (v: FontName) => commitStyle({ fontFamily: v });
  const setTextAlign = (v: TextAlignName) => commitStyle({ textAlign: v });
  const setStartArrowhead = (v: ArrowheadName) => commitStyle({ startArrowhead: v });
  const setEndArrowhead = (v: ArrowheadName) => commitStyle({ endArrowhead: v });

  return {
    strokeColor,
    setStrokeColor,
    strokeWidth,
    setStrokeWidth,
    fillStyle,
    setFillStyle,
    backgroundColor,
    setBackgroundColor,
    strokeStyle,
    setStrokeStyle,
    opacity,
    setOpacity,
    roundness,
    setRoundness,
    roughness,
    setRoughness,
    fontSize,
    setFontSize,
    fontFamily,
    setFontFamily,
    textAlign,
    setTextAlign,
    startArrowhead,
    setStartArrowhead,
    endArrowhead,
    setEndArrowhead,
    styleByTool,
    activeStyle,
    selectionStyle,
    commitStyle,
    beginStyleGesture,
    liveStyle,
    endStyleGesture,
    isFillAuto,
    resetFillAuto,
    onToolSwitch,
    snapshotGlobals,
  };
}

export type WhiteboardStyleState = ReturnType<typeof useWhiteboardStyle>;
