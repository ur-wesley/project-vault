import { describe, it, expect } from "vitest";
import {
  applyStylePatch,
  arrowheadNameOf,
  arrowheadToNative,
  defaultStyleFor,
  expandPatchAuto,
  isArrowLabelOnly,
  propagateConnectorStyle,
  scopePatchForSelection,
  selectionStyleFor,
} from "./whiteboardStyle";
import { newElement } from "./excalidrawDefaults";
import type { ExcalidrawElement, ExcalidrawTextElement } from "./excalidrawTypes";
import { parseWhiteboardData, encodeWhiteboardData } from "./serialize";
import { emptyScene } from "./excalidrawDefaults";
import { renderBoard } from "./render";

function rect(id = "r"): ExcalidrawElement {
  return newElement("rectangle", { id, x: 0, y: 0, width: 50, height: 50 });
}

function arrow(id = "a"): Extract<ExcalidrawElement, { type: "arrow" }> {
  return newElement("arrow", {
    id,
    x: 0,
    y: 0,
    points: [
      [0, 0],
      [60, 0],
    ],
    startBinding: null,
    endBinding: null,
  }) as Extract<ExcalidrawElement, { type: "arrow" }>;
}

function text(id = "t"): ExcalidrawTextElement {
  return newElement("text", { id, x: 0, y: 0, text: "hi" }) as ExcalidrawTextElement;
}

function stubCtx() {
  const calls: string[] = [];
  const canvas = { width: 400, height: 300 };
  const ctx = new Proxy(
    { canvas },
    {
      get(_t, prop: string) {
        if (prop === "canvas") return canvas;
        return (...args: unknown[]) => {
          calls.push(String(prop));
          void args;
          if (prop === "measureText") return { width: 10 };
          return undefined;
        };
      },
      set() {
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe("applyStylePatch", () => {
  it("restyles shapes with fill but ignores arrowheads", () => {
    const out = applyStylePatch(rect(), {
      fillStyle: "hachure",
      backgroundColor: "#ef4444",
      startArrowhead: "dot",
      fontSize: 28,
    });
    expect(out).toMatchObject({ fillStyle: "hachure", backgroundColor: "#ef4444" });
    if (out.type !== "rectangle") throw new Error("expected rect");
    expect(out).not.toHaveProperty("startArrowhead");
  });

  it("restyles connectors with arrowheads but ignores fill", () => {
    const out = applyStylePatch(arrow(), {
      startArrowhead: "dot",
      endArrowhead: "none",
      strokeStyle: "dashed",
      fillStyle: "solid",
    });
    expect(out).toMatchObject({
      startArrowhead: "dot",
      endArrowhead: null,
      strokeStyle: "dashed",
    });
    if (out.type !== "arrow") throw new Error("expected arrow");
    expect(out.fillStyle).toBe("transparent");
  });

  it("restyles text with font fields and maps roundness per type", () => {
    const out = applyStylePatch(text(), {
      fontSize: 28,
      fontFamily: "code",
      textAlign: "right",
      roundness: "sharp",
    });
    expect(out).toMatchObject({ fontSize: 28, fontFamily: 3, textAlign: "right" });
    if (out.type !== "text") throw new Error("expected text");
    expect(out.roundness).toEqual({ type: 0 });
    const roundRect = applyStylePatch(rect(), { roundness: "round" });
    if (roundRect.type !== "rectangle") throw new Error("expected rect");
    expect(roundRect.roundness).toEqual({ type: 3 });
  });

  it("maps arrowhead names both ways", () => {
    expect(arrowheadToNative("none")).toBeNull();
    expect(arrowheadToNative("arrow")).toBe("arrow");
    expect(arrowheadNameOf("triangle", "none")).toBe("arrow");
    expect(arrowheadNameOf(null, "arrow")).toBe("arrow");
    expect(arrowheadNameOf(undefined, "none")).toBe("none");
  });

  it("expands auto background tints only in auto mode", () => {
    const out = expandPatchAuto({ strokeColor: "#ef4444" }, true);
    expect(out.backgroundColor).toBeDefined();
    expect(expandPatchAuto({ strokeColor: "#ef4444" }, false)).toEqual({
      strokeColor: "#ef4444",
    });
    expect(
      expandPatchAuto({ strokeColor: "#ef4444", backgroundColor: "#000000" }, true),
    ).toEqual({ strokeColor: "#ef4444", backgroundColor: "#000000" });
  });

  it("merges selection styles, dropping mixed fields", () => {
    const els = [rect("r1"), { ...rect("r2"), strokeColor: "#ef4444" }];
    const merged = selectionStyleFor(els, ["r1", "r2"]);
    expect(merged.strokeColor).toBeUndefined();
    expect(merged.strokeWidth).toBe(2);
    expect(selectionStyleFor(els, [])).toEqual({});
    expect(defaultStyleFor("arrow")).toMatchObject({
      startArrowhead: "none",
      endArrowhead: "arrow",
    });
  });
});

describe("style serialize", () => {
  it("keeps native v2 styles through encode/parse", () => {
    const els: ExcalidrawElement[] = [
      {
        ...rect(),
        fillStyle: "cross-hatch",
        backgroundColor: "#eab308",
        strokeStyle: "dotted",
        opacity: 50,
        roundness: { type: 0 },
      },
      { ...arrow(), startArrowhead: "dot", endArrowhead: "dot" },
      { ...text(), fontFamily: 1, textAlign: "right" },
    ];
    const scene = { ...emptyScene(), elements: els };
    const json = encodeWhiteboardData(scene);
    expect(parseWhiteboardData(json).elements).toEqual(els);
  });

  it("drops unknown element types but keeps valid ones", () => {
    const scene = { ...emptyScene(), elements: [rect()] };
    const raw = JSON.stringify({ ...scene, elements: [...scene.elements, { type: "nope" }] });
    expect(parseWhiteboardData(raw).elements).toHaveLength(1);
  });
});

describe("style render", () => {
  it("paints fills, dashes, heads and styled text without throwing", () => {
    const els: ExcalidrawElement[] = [
      {
        ...rect(),
        fillStyle: "hachure",
        backgroundColor: "#ef4444",
        strokeStyle: "dashed",
        opacity: 60,
        roundness: { type: 0 },
      },
      { ...rect("r2"), fillStyle: "solid", backgroundColor: "#22c55e", x: 60 },
      { ...arrow(), startArrowhead: "dot", endArrowhead: "arrow", strokeStyle: "dotted" },
      { ...text(), fontFamily: 3, fontSize: 20, textAlign: "right" },
    ];
    const { ctx, calls } = stubCtx();
    expect(() => renderBoard(ctx, els, null, [], { selectedIds: [] })).not.toThrow();
    expect(calls.length).toBeGreaterThan(0);
  });

  it("isolates a corrupt element instead of blanking the board", () => {
    const good = { ...rect(), fillStyle: "solid" as const, backgroundColor: "#22c55e" };
    const corrupt = {
      ...rect(),
      id: "bad",
      strokeColor: undefined,
      strokeWidth: undefined,
    } as unknown as ExcalidrawElement;
    const { ctx, calls } = stubCtx();
    expect(() => renderBoard(ctx, [corrupt, good], null, [], { selectedIds: [] })).not.toThrow();
    // The valid element still paints (fill + stroke) despite corrupt siblings.
    expect(calls).toContain("fill");
    expect(calls).toContain("stroke");
  });

  it("cuts the connector stroke behind a bound label pill", () => {
    const a = { ...arrow(), boundElements: [{ type: "text" as const, id: "t" }] };
    const t = { ...text("t"), text: "edge", fontSize: 16, containerId: "a", textAlign: "center" as const };
    const els: ExcalidrawElement[] = [a, t];
    const { ctx, calls } = stubCtx();
    const strokesBefore = calls.filter((c) => c === "stroke").length;
    expect(() =>
      renderBoard(ctx, els, null, [], {
        selectedIds: [],
        textAnchors: new Map([["t", { x: 30, y: 0 }]]),
        textLayouts: new Map([["t", { lines: ["edge"], width: 30, height: 20, wrap: 220 }]]),
        pillIds: new Set(["t"]),
      }),
    ).not.toThrow();
    // Split line (2 runs) + pill fill + head fill.
    expect(calls.filter((c) => c === "stroke").length).toBeGreaterThan(strokesBefore + 1);
    expect(calls).toContain("fillText");
  });
});

describe("arrow-label style scoping", () => {
  const board = (): ExcalidrawElement[] => [
    { ...arrow(), strokeColor: "#ef4444", boundElements: [{ type: "text" as const, id: "t" }] },
    { ...text(), strokeColor: "#ef4444", containerId: "a", textAlign: "center" },
    rect(),
  ];

  it("detects arrow-label-only selections", () => {
    const els = board();
    expect(isArrowLabelOnly(els, ["t"])).toBe(true);
    expect(isArrowLabelOnly(els, [])).toBe(false);
    expect(isArrowLabelOnly(els, ["t", "a"])).toBe(false);
    expect(isArrowLabelOnly(els, ["r"])).toBe(false);
    expect(isArrowLabelOnly(els, ["ghost"])).toBe(false);
  });

  it("narrows patches for arrow labels down to font size", () => {
    const els = board();
    expect(
      scopePatchForSelection(els, ["t"], { strokeColor: "#22c55e", fontSize: 28 }),
    ).toEqual({ fontSize: 28 });
    expect(scopePatchForSelection(els, ["t"], { strokeColor: "#22c55e" })).toEqual({});
    expect(scopePatchForSelection(els, ["a"], { strokeColor: "#22c55e" })).toEqual({
      strokeColor: "#22c55e",
    });
  });

  it("propagates connector color/opacity/size to bound labels", () => {
    const els = board();
    const out = propagateConnectorStyle(els, ["a"], { strokeColor: "#22c55e", opacity: 50 });
    const label = out.find((el) => el.id === "t");
    expect(label).toMatchObject({ strokeColor: "#22c55e", opacity: 50 });
    const sized = propagateConnectorStyle(els, ["a"], { fontSize: 28 });
    expect(sized.find((el) => el.id === "t")).toMatchObject({ fontSize: 28 });
    // Unrelated elements untouched; no connector selected → identical.
    expect(out.find((el) => el.id === "r")).toEqual(els[2]);
    expect(propagateConnectorStyle(els, ["a"], { strokeWidth: 4 })).toBe(els);
    expect(propagateConnectorStyle(els, ["t"], { strokeColor: "#22c55e" })).toBe(els);
  });
});
