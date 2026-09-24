import { describe, it, expect } from "vitest";
import {
  boundTextsFor,
  dedupeBoundTexts,
  excludeInseparableLabels,
  isInseparableLabel,
  redirectLabelHit,
  resolveBoundTextPosition,
  resolveGroupLabelPosition,
  linkBoundText,
  cascadeDeleteIds,
  getTextBounds,
  snapLabelsToCenter,
} from "./boundText";
import { baseElement, type WhiteboardElement } from "./types";

const rect = (id: string): WhiteboardElement => ({
  ...baseElement(id, "#e5e5e5", 2),
  kind: "rectangle",
  start: { x: 0, y: 0 },
  end: { x: 100, y: 50 },
});

const text = (
  id: string,
  partial?: Partial<Extract<WhiteboardElement, { kind: "text" }>>,
): WhiteboardElement => ({
  ...baseElement(id, "#e5e5e5", 2),
  kind: "text",
  position: { x: 0, y: 0 },
  text: "hi",
  fontSize: 14,
  fontFamily: "normal",
  bold: false,
  italic: false,
  containerId: null,
  labelGroupId: null,
  offset: { x: 0, y: 0 },
  width: null,
  textAlign: "left",
  ...partial,
});

const arrowEl = (
  id: string,
  startBinding: { elementId: string; gap: number } | null,
): WhiteboardElement => ({
  ...baseElement(id, "#e5e5e5", 2),
  kind: "arrow",
  start: { x: 0, y: 0 },
  end: { x: 200, y: 0 },
  startBinding,
  endBinding: null,
  startArrow: "none",
  endArrow: "arrow",
  waypoints: [],
});

describe("resolveBoundTextPosition", () => {
  it("centers shape labels plus offset", () => {
    const els = [rect("s"), text("t", { containerId: "s", offset: { x: 5, y: 0 } })];
    const t = els[1] as Extract<WhiteboardElement, { kind: "text" }>;
    expect(resolveBoundTextPosition(els, t)).toEqual({ x: 55, y: 25 });
  });

  it("places arrow labels at the resolved midpoint", () => {
    const els = [
      rect("s"),
      arrowEl("a", { elementId: "s", gap: 0 }),
      text("t", { containerId: "a" }),
    ];
    const t = els[2] as Extract<WhiteboardElement, { kind: "text" }>;
    const pos = resolveBoundTextPosition(els, t);
    // Bound start exits the rect's right edge toward (200,0): the ray from
    // center (50,25) through (200,0) hits x=100 at y=25-25*50/150. Midpoint
    // of (100, 16.67)-(200,0) is (150, 8.33).
    expect(pos.x).toBeCloseTo(150, 0);
    expect(pos.y).toBeCloseTo(8.33, 0);
  });

  it("falls back to stored position for missing containers", () => {
    const t = text("t", { containerId: "ghost" }) as Extract<WhiteboardElement, { kind: "text" }>;
    expect(resolveBoundTextPosition([t], t)).toEqual({ x: 0, y: 0 });
  });
});

describe("resolveGroupLabelPosition", () => {
  it("sits above the union top-center", () => {
    expect(
      resolveGroupLabelPosition(
        { minX: 0, maxX: 100, minY: 50, maxY: 150 },
        text("t") as Extract<WhiteboardElement, { kind: "text" }>,
      ),
    ).toEqual({ x: 50, y: 42 });
  });
});

describe("linkBoundText", () => {
  it("links both sides exactly once", () => {
    const els = [rect("s"), text("t")];
    const once = linkBoundText(els, "s", "t");
    const twice = linkBoundText(once, "s", "t");
    const container = twice.find((e) => e.id === "s");
    expect(container).toMatchObject({ boundElements: [{ type: "text", id: "t" }] });
    expect(twice.find((e) => e.id === "t")).toMatchObject({ containerId: "s" });
  });
});

describe("cascadeDeleteIds", () => {
  it("removes bound texts with their container", () => {
    const els = [rect("s"), text("t", { containerId: "s" }), text("free")];
    expect(cascadeDeleteIds(els, new Set(["s"]))).toEqual(new Set(["s", "t"]));
  });

  it("removes arrows bound to deleted shapes, plus their labels (chains)", () => {
    const els = [
      rect("s"),
      arrowEl("a", { elementId: "s", gap: 0 }),
      text("t", { containerId: "a" }),
      rect("other"),
    ];
    expect(cascadeDeleteIds(els, new Set(["s"]))).toEqual(new Set(["s", "a", "t"]));
  });
});

describe("getTextBounds", () => {
  it("centers bound text boxes on the anchor", () => {
    const els = [rect("s"), text("t", { containerId: "s" })];
    const t = els[1] as Extract<WhiteboardElement, { kind: "text" }>;
    const b = getTextBounds(els, t);
    expect((b.minX + b.maxX) / 2).toBeCloseTo(50, 5);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(25, 5);
  });

  it("grows taller with newlines (multiline)", () => {
    const els = [rect("s"), text("t", { containerId: "s", text: "a\nb\nc" })];
    const t = els[1] as Extract<WhiteboardElement, { kind: "text" }>;
    const single = getTextBounds([rect("s"), text("t2", { containerId: "s", text: "a" })], {
      ...(els[1] as Extract<WhiteboardElement, { kind: "text" }>),
      text: "a",
    });
    const multi = getTextBounds(els, t);
    expect(multi.maxY - multi.minY).toBeGreaterThan(single.maxY - single.minY);
    expect((multi.minX + multi.maxX) / 2).toBeCloseTo(50, 5);
  });

  it("wraps free fixed-width text instead of growing a single line", () => {
    const els = [text("t", { text: "hello world foo bar", width: 60 })];
    const t = els[0] as Extract<WhiteboardElement, { kind: "text" }>;
    const b = getTextBounds(els, t);
    expect(b.maxX - b.minX).toBeCloseTo(60, 0);
    expect(b.maxY - b.minY).toBeGreaterThan(14 * 1.25);
  });

  it("includes pill padding for arrow labels", () => {
    const els = [
      rect("s"),
      arrowEl("a", { elementId: "s", gap: 0 }),
      text("t", { containerId: "a", text: "edge" }),
    ];
    const t = els[2] as Extract<WhiteboardElement, { kind: "text" }>;
    const b = getTextBounds(els, t);
    expect(b.maxX - b.minX).toBeGreaterThan("edge".length * 14 * 0.55);
  });
});

describe("growContainerForText", () => {
  it("expands narrow shapes to fit wrapped text", async () => {
    const { growContainerForText } = await import("./boundText");
    const small = rect("s");
    if (small.kind !== "rectangle") throw new Error("expected rect");
    const narrow = { ...small, start: { x: 0, y: 0 }, end: { x: 30, y: 20 } };
    const t = text("t", { containerId: "s", text: "hello world this is long" });
    const grown = growContainerForText(narrow, t as Extract<WhiteboardElement, { kind: "text" }>);
    if (grown.kind !== "rectangle") throw new Error("expected rect");
    expect(grown.end.x - grown.start.x).toBeGreaterThanOrEqual(30);
    expect(grown.end.y - grown.start.y).toBeGreaterThan(20);
  });

  it("keeps containers that already fit", async () => {
    const { growContainerForText } = await import("./boundText");
    const t = text("t", { containerId: "s", text: "hi" });
    const grown = growContainerForText(
      rect("s"),
      t as Extract<WhiteboardElement, { kind: "text" }>,
    );
    expect(grown).toEqual(rect("s"));
  });
});

describe("dedupeBoundTexts", () => {
  const arrowWith = (boundIds: string[]): WhiteboardElement => ({
    ...arrowEl("a", null),
    boundElements: boundIds.map((id) => ({ type: "text" as const, id })),
  });

  it("returns the input unchanged for zero or one bound text", () => {
    const els = [arrowWith([])];
    expect(dedupeBoundTexts(els, "a")).toBe(els);
    const single = [arrowWith(["t1"]), text("t1", { containerId: "a" })];
    expect(dedupeBoundTexts(single, "a")).toBe(single);
  });

  it("keeps the first text and converts extras to free texts without losing content", () => {
    const els = [
      arrowWith(["t1", "t2"]),
      text("t1", { containerId: "a", text: "first" }),
      text("t2", { containerId: "a", text: "second" }),
    ];
    expect(boundTextsFor(els, "a").map((t) => t.id)).toEqual(["t1", "t2"]);
    const out = dedupeBoundTexts(els, "a");
    expect(boundTextsFor(out, "a").map((t) => t.id)).toEqual(["t1"]);
    const extra = out.find((el) => el.id === "t2");
    if (!extra || extra.kind !== "text") throw new Error("expected freed text");
    expect(extra.containerId).toBeNull();
    expect(extra.text).toBe("second");
    // Freed text starts where its pill was (same top-left, pill pad dropped).
    const oldBox = getTextBounds(els, els[2] as Extract<WhiteboardElement, { kind: "text" }>);
    expect(extra.position).toEqual({ x: oldBox.minX, y: oldBox.minY });
    const container = out.find((el) => el.id === "a");
    if (!container || container.kind === "text") throw new Error("expected arrow");
    expect(container.boundElements.map((b) => b.id)).toEqual(["t1"]);
  });
});

describe("inseparable arrow labels", () => {
  const els: WhiteboardElement[] = [
    { ...arrowEl("a", null), boundElements: [{ type: "text" as const, id: "t" }] },
    text("t", { containerId: "a" }),
    rect("s"),
    text("f"),
  ];

  it("detects arrow-bound labels only", () => {
    expect(isInseparableLabel(els, "t")).toBe(true);
    expect(isInseparableLabel(els, "f")).toBe(false);
    expect(isInseparableLabel(els, "a")).toBe(false);
    expect(isInseparableLabel(els, "ghost")).toBe(false);
  });

  it("redirects label hits to the connector", () => {
    const label = els.find((el) => el.id === "t") as WhiteboardElement;
    const arrow = els.find((el) => el.id === "a") as WhiteboardElement;
    expect(redirectLabelHit(els, label)).toBe(arrow);
    expect(redirectLabelHit(els, arrow)).toBe(arrow);
    expect(redirectLabelHit(els, null)).toBeNull();
  });

  it("excludes labels from id lists", () => {
    expect(excludeInseparableLabels(els, ["a", "t", "s", "f"])).toEqual(["a", "s", "f"]);
  });

  it("snaps offsets to center, returning input when already centered", () => {
    expect(snapLabelsToCenter(els, "a")).toBe(els);
    const moved = els.map((el) =>
      el.id === "t" && el.kind === "text" ? { ...el, offset: { x: 9, y: -4 } } : el,
    );
    const out = snapLabelsToCenter(moved, "a");
    expect(out).not.toBe(moved);
    const t = out.find((el) => el.id === "t");
    expect(t).toMatchObject({ offset: { x: 0, y: 0 } });
  });
});
