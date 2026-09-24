import { describe, it, expect } from "vitest";
import {
  applyStylePatch,
  isArrowLabelOnly,
  propagateConnectorStyle,
  scopePatchForSelection,
} from "./useWhiteboardStore";
import { baseElement } from "./types";
import type { WhiteboardElement } from "./types";
import { parseWhiteboardData, encodeWhiteboardData } from "./serialize";
import { renderBoard } from "./render";

function rect(): WhiteboardElement {
  return {
    ...baseElement("r", "#e5e5e5", 2),
    kind: "rectangle",
    start: { x: 0, y: 0 },
    end: { x: 50, y: 50 },
  };
}

function arrow(): Extract<WhiteboardElement, { kind: "arrow" }> {
  return {
    ...baseElement("a", "#e5e5e5", 2),
    kind: "arrow",
    start: { x: 0, y: 0 },
    end: { x: 60, y: 0 },
    startBinding: null,
    endBinding: null,
    startArrow: "none",
    endArrow: "arrow",
    waypoints: [],
  };
}

function text(): Extract<WhiteboardElement, { kind: "text" }> {
  return {
    ...baseElement("t", "#e5e5e5", 2),
    kind: "text",
    position: { x: 0, y: 0 },
    text: "hi",
    fontSize: 16,
    fontFamily: "normal",
    bold: false,
    italic: false,
    containerId: null,
    labelGroupId: null,
    offset: { x: 0, y: 0 },
    width: null,
    textAlign: "left",
  };
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
      background: "hachure",
      fillColor: "#ef4444",
      startArrow: "dot",
      fontSize: 28,
    });
    expect(out.background).toBe("hachure");
    expect(out.fillColor).toBe("#ef4444");
    expect(out).not.toHaveProperty("startArrow");
    expect(out).not.toHaveProperty("fontSize");
  });

  it("restyles connectors with arrowheads but ignores fill", () => {
    const out = applyStylePatch(arrow(), {
      startArrow: "dot",
      endArrow: "none",
      strokeStyle: "dashed",
      background: "solid",
    }) as Extract<WhiteboardElement, { kind: "arrow" }>;
    expect(out.startArrow).toBe("dot");
    expect(out.endArrow).toBe("none");
    expect(out.strokeStyle).toBe("dashed");
    expect(out.background).toBe("transparent");
  });

  it("restyles text with font fields", () => {
    const out = applyStylePatch(text(), {
      fontSize: 28,
      fontFamily: "code",
      bold: true,
      italic: true,
      textAlign: "right",
    }) as Extract<WhiteboardElement, { kind: "text" }>;
    expect(out).toMatchObject({
      fontSize: 28,
      fontFamily: "code",
      bold: true,
      italic: true,
      textAlign: "right",
    });
  });
});

describe("style serialize", () => {
  it("migrates v4 boards to v5 style defaults", () => {
    const raw = JSON.stringify({
      version: 4,
      elements: [
        {
          id: "a",
          kind: "rectangle",
          color: "#ef4444",
          strokeWidth: 4,
          start: { x: 0, y: 0 },
          end: { x: 5, y: 5 },
        },
      ],
    });
    const [el] = parseWhiteboardData(raw).elements;
    expect(el).toMatchObject({
      background: "transparent",
      strokeStyle: "solid",
      opacity: 100,
      roundness: "round",
    });
  });

  it("falls back on invalid enums but keeps custom hex", () => {
    const raw = JSON.stringify({
      version: 5,
      elements: [
        {
          id: "a",
          kind: "rectangle",
          color: "#123abc",
          strokeWidth: 2,
          background: "glitter",
          strokeStyle: "wavy",
          opacity: 999,
          roundness: "squishy",
          start: { x: 0, y: 0 },
          end: { x: 5, y: 5 },
        },
      ],
    });
    const [el] = parseWhiteboardData(raw).elements;
    expect(el.color).toBe("#123abc");
    expect(el).toMatchObject({
      background: "transparent",
      strokeStyle: "solid",
      opacity: 100,
      roundness: "round",
    });
  });

  it("round-trips full v5 styles", () => {
    const els: WhiteboardElement[] = [
      {
        ...rect(),
        background: "cross-hatch",
        fillColor: "#eab308",
        strokeStyle: "dotted",
        opacity: 50,
        roundness: "sharp",
      },
      { ...arrow(), startArrow: "dot", endArrow: "dot" },
      { ...text(), fontFamily: "hand", bold: true, textAlign: "right" },
    ];
    const json = encodeWhiteboardData({ version: 5, elements: els });
    expect(parseWhiteboardData(json).elements).toEqual(els);
  });
});

describe("style render", () => {
  it("paints fills, dashes, heads and styled text without throwing", () => {
    const els: WhiteboardElement[] = [
      {
        ...rect(),
        background: "hachure",
        fillColor: "#ef4444",
        strokeStyle: "dashed",
        opacity: 60,
        roundness: "sharp",
      },
      {
        ...rect(),
        background: "solid",
        fillColor: "#22c55e",
        roundness: "round",
        start: { x: 60, y: 0 },
        end: { x: 110, y: 50 },
      },
      { ...arrow(), startArrow: "dot", endArrow: "arrow", strokeStyle: "dotted" },
      { ...text(), fontFamily: "code", bold: true, italic: true, fontSize: 20, textAlign: "right" },
    ];
    const { ctx, calls } = stubCtx();
    expect(() => renderBoard(ctx, els, null, [], { selectedIds: [] })).not.toThrow();
    expect(calls.length).toBeGreaterThan(0);
  });

  it("isolates a corrupt element instead of blanking the board", () => {
    const good = { ...rect(), background: "solid", fillColor: "#22c55e" };
    const corrupt = {
      ...rect(),
      id: "bad",
      // Simulate a foreign/hand-edited payload missing style fields entirely.
      color: undefined,
      strokeWidth: undefined,
      opacity: undefined,
      background: "glitter",
      strokeStyle: "wavy",
      start: { x: 200, y: 0 },
      end: { x: 250, y: 50 },
    } as unknown as WhiteboardElement;
    const badText = {
      ...text(),
      id: "bad-text",
      text: undefined,
      fontSize: undefined,
    } as unknown as WhiteboardElement;
    const { ctx, calls } = stubCtx();
    expect(() =>
      renderBoard(ctx, [corrupt, good, badText], null, [], { selectedIds: [] }),
    ).not.toThrow();
    // The valid element still paints (fill + stroke) despite corrupt siblings.
    expect(calls).toContain("fill");
    expect(calls).toContain("stroke");
  });

  it("cuts the connector stroke behind a bound label pill", () => {
    const a = { ...arrow(), id: "a", boundElements: [{ type: "text" as const, id: "t" }] };
    const t = {
      ...text(),
      id: "t",
      text: "edge",
      fontSize: 16,
      containerId: "a",
      textAlign: "center" as const,
    };
    const els: WhiteboardElement[] = [a, t];
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
  const board = (): WhiteboardElement[] => [
    { ...arrow(), id: "a", color: "#ef4444", boundElements: [{ type: "text" as const, id: "t" }] },
    { ...text(), id: "t", color: "#ef4444", containerId: "a", textAlign: "center" as const },
    { ...rect() },
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
      scopePatchForSelection(els, ["t"], { color: "#22c55e", bold: true, fontSize: 28 }),
    ).toEqual({ fontSize: 28 });
    expect(scopePatchForSelection(els, ["t"], { color: "#22c55e" })).toEqual({});
    expect(scopePatchForSelection(els, ["a"], { color: "#22c55e" })).toEqual({
      color: "#22c55e",
    });
  });

  it("propagates connector color/opacity/size to bound labels", () => {
    const els = board();
    const out = propagateConnectorStyle(els, ["a"], { color: "#22c55e", opacity: 50 });
    const label = out.find((el) => el.id === "t");
    expect(label).toMatchObject({ color: "#22c55e", opacity: 50 });
    const sized = propagateConnectorStyle(els, ["a"], { fontSize: 28 });
    expect(sized.find((el) => el.id === "t")).toMatchObject({ fontSize: 28 });
    // Unrelated elements untouched; no connector selected → identical.
    expect(out.find((el) => el.id === "r")).toEqual(els[2]);
    expect(propagateConnectorStyle(els, ["a"], { strokeWidth: 4 })).toBe(els);
    expect(propagateConnectorStyle(els, ["t"], { color: "#22c55e" })).toBe(els);
  });
});
