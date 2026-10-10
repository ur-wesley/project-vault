import { describe, it, expect } from "vitest";
import {
  boundTextsFor,
  dedupeBoundTexts,
  excludeInseparableLabels,
  isInseparableLabel,
  redirectLabelHit,
  resolveBoundTextPosition,
  linkBoundText,
  cascadeDeleteIds,
  getTextBounds,
  syncBoundTextOrigins,
  textWrapWidth,
  frameLabel,
} from "./boundText";
import { newElement } from "./excalidrawDefaults";
import type { NewElementPatch } from "./excalidrawDefaults";
import type {
  ExcalidrawArrowElement,
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "./excalidrawTypes";

type NativeBinding = NonNullable<ExcalidrawArrowElement["startBinding"]>;

/** Relative-points literal helper (keeps `[x, y]` tuple typing). */
const P = (...ps: Array<[number, number]>): Array<[number, number]> => ps;

const rect = (id: string): ExcalidrawElement =>
  newElement("rectangle", { id, x: 0, y: 0, width: 100, height: 50 });

const text = (id: string, patch?: NewElementPatch<"text">): ExcalidrawTextElement =>
  newElement("text", { id, x: 0, y: 0, text: "hi", fontSize: 14, ...patch }) as ExcalidrawTextElement;

const arrowEl = (id: string, startBinding: NativeBinding | null): ExcalidrawArrowElement =>
  newElement("arrow", {
    id,
    x: 0,
    y: 0,
    points: P([0, 0], [200, 0]),
    startBinding,
    endBinding: null,
  }) as ExcalidrawArrowElement;

describe("resolveBoundTextPosition", () => {
  it("centers shape labels on the container", () => {
    const els: ExcalidrawElement[] = [rect("s"), text("t", { containerId: "s" })];
    const t = els[1] as ExcalidrawTextElement;
    expect(resolveBoundTextPosition(els, t)).toEqual({ x: 50, y: 25 });
  });

  it("places arrow labels at the resolved midpoint", () => {
    const els: ExcalidrawElement[] = [
      rect("s"),
      arrowEl("a", { elementId: "s", gap: 0, focus: 0 }),
      text("t", { containerId: "a" }),
    ];
    const t = els[2] as ExcalidrawTextElement;
    const pos = resolveBoundTextPosition(els, t);
    // Bound start exits the rect's right edge toward (200,0): the ray from
    // center (50,25) through (200,0) hits x=100 at y=25-25*50/150. Midpoint
    // of (100, 16.67)-(200,0) is (150, 8.33).
    expect(pos.x).toBeCloseTo(150, 0);
    expect(pos.y).toBeCloseTo(8.33, 0);
  });

  it("falls back to stored x/y for missing containers", () => {
    const t = text("t", { containerId: "ghost" });
    expect(resolveBoundTextPosition([t], t)).toEqual({ x: 0, y: 0 });
  });
});

describe("linkBoundText", () => {
  it("links both sides exactly once and syncs originalText", () => {
    const els: ExcalidrawElement[] = [rect("s"), text("t")];
    const once = linkBoundText(els, "s", "t");
    const twice = linkBoundText(once, "s", "t");
    const container = twice.find((e) => e.id === "s");
    expect(container).toMatchObject({ boundElements: [{ type: "text", id: "t" }] });
    expect(twice.find((e) => e.id === "t")).toMatchObject({ containerId: "s", originalText: "hi" });
  });

  it("keeps an existing originalText", () => {
    const els: ExcalidrawElement[] = [rect("s"), text("t", { originalText: "first" })];
    const out = linkBoundText(els, "s", "t");
    expect(out.find((e) => e.id === "t")).toMatchObject({ originalText: "first" });
  });
});

describe("cascadeDeleteIds", () => {
  it("removes bound texts with their container", () => {
    const els: ExcalidrawElement[] = [rect("s"), text("t", { containerId: "s" }), text("free")];
    expect(cascadeDeleteIds(els, new Set(["s"]))).toEqual(new Set(["s", "t"]));
  });

  it("removes arrows bound to deleted shapes, plus their labels (chains)", () => {
    const els: ExcalidrawElement[] = [
      rect("s"),
      arrowEl("a", { elementId: "s", gap: 0, focus: 0 }),
      text("t", { containerId: "a" }),
      rect("other"),
    ];
    expect(cascadeDeleteIds(els, new Set(["s"]))).toEqual(new Set(["s", "a", "t"]));
  });
});

describe("getTextBounds", () => {
  it("centers bound text boxes on the anchor", () => {
    const els: ExcalidrawElement[] = [rect("s"), text("t", { containerId: "s" })];
    const t = els[1] as ExcalidrawTextElement;
    const b = getTextBounds(els, t);
    expect((b.minX + b.maxX) / 2).toBeCloseTo(50, 5);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(25, 5);
  });

  it("grows taller with newlines (multiline)", () => {
    const els: ExcalidrawElement[] = [rect("s"), text("t", { containerId: "s", text: "a\nb\nc" })];
    const t = els[1] as ExcalidrawTextElement;
    const single = getTextBounds([rect("s"), text("t2", { containerId: "s", text: "a" })], {
      ...t,
      text: "a",
    });
    const multi = getTextBounds(els, t);
    expect(multi.maxY - multi.minY).toBeGreaterThan(single.maxY - single.minY);
    expect((multi.minX + multi.maxX) / 2).toBeCloseTo(50, 5);
  });

  it("wraps free fixed-width text instead of growing a single line", () => {
    const els: ExcalidrawElement[] = [
      text("t", { text: "hello world foo bar", width: 60, autoResize: false }),
    ];
    const t = els[0] as ExcalidrawTextElement;
    const b = getTextBounds(els, t);
    expect(b.maxX - b.minX).toBeCloseTo(60, 0);
    expect(b.maxY - b.minY).toBeGreaterThan(14 * 1.25);
  });

  it("includes pill padding for arrow labels", () => {
    const els: ExcalidrawElement[] = [
      rect("s"),
      arrowEl("a", { elementId: "s", gap: 0, focus: 0 }),
      text("t", { containerId: "a", text: "edge" }),
    ];
    const t = els[2] as ExcalidrawTextElement;
    const b = getTextBounds(els, t);
    expect(b.maxX - b.minX).toBeGreaterThan("edge".length * 14 * 0.55);
  });
});

describe("growContainerForText", () => {
  it("expands narrow shapes to fit wrapped text", async () => {
    const { growContainerForText } = await import("./boundText");
    const narrow = newElement("rectangle", { id: "s", x: 0, y: 0, width: 30, height: 20 });
    const t = text("t", { containerId: "s", text: "hello world this is long" });
    const grown = growContainerForText(narrow, t);
    if (grown.type !== "rectangle") throw new Error("expected rect");
    expect(grown.width).toBeGreaterThanOrEqual(30);
    expect(grown.height).toBeGreaterThan(20);
  });

  it("keeps containers that already fit", async () => {
    const { growContainerForText } = await import("./boundText");
    const t = text("t", { containerId: "s", text: "hi" });
    const big = rect("s");
    expect(growContainerForText(big, t)).toBe(big);
  });
});

describe("dedupeBoundTexts", () => {
  const arrowWith = (boundIds: string[]): ExcalidrawElement => ({
    ...arrowEl("a", null),
    boundElements: boundIds.map((id) => ({ type: "text" as const, id })),
  });

  it("returns the input unchanged for zero or one bound text", () => {
    const els: ExcalidrawElement[] = [arrowWith([])];
    expect(dedupeBoundTexts(els, "a")).toBe(els);
    const single: ExcalidrawElement[] = [arrowWith(["t1"]), text("t1", { containerId: "a" })];
    expect(dedupeBoundTexts(single, "a")).toBe(single);
  });

  it("keeps the first text and converts extras to free texts without losing content", () => {
    const els: ExcalidrawElement[] = [
      arrowWith(["t1", "t2"]),
      text("t1", { containerId: "a", text: "first" }),
      text("t2", { containerId: "a", text: "second" }),
    ];
    expect(boundTextsFor(els, "a").map((t) => t.id)).toEqual(["t1", "t2"]);
    const out = dedupeBoundTexts(els, "a");
    expect(boundTextsFor(out, "a").map((t) => t.id)).toEqual(["t1"]);
    const extra = out.find((el) => el.id === "t2");
    if (!extra || extra.type !== "text") throw new Error("expected freed text");
    expect(extra.containerId).toBeNull();
    expect(extra.text).toBe("second");
    // Freed text starts where its pill was (same top-left, pill pad dropped).
    const oldBox = getTextBounds(els, els[2] as ExcalidrawTextElement);
    expect(extra.x).toBeCloseTo(oldBox.minX, 5);
    expect(extra.y).toBeCloseTo(oldBox.minY, 5);
    const container = out.find((el) => el.id === "a");
    if (!container || container.type === "text") throw new Error("expected arrow");
    expect((container.boundElements ?? []).map((b) => b.id)).toEqual(["t1"]);
  });
});

describe("inseparable arrow labels", () => {
  const els: ExcalidrawElement[] = [
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
    const label = els.find((el) => el.id === "t") as ExcalidrawElement;
    const arrow = els.find((el) => el.id === "a") as ExcalidrawElement;
    expect(redirectLabelHit(els, label)).toBe(arrow);
    expect(redirectLabelHit(els, arrow)).toBe(arrow);
    expect(redirectLabelHit(els, null)).toBeNull();
  });

  it("excludes labels from id lists", () => {
    expect(excludeInseparableLabels(els, ["a", "t", "s", "f"])).toEqual(["a", "s", "f"]);
  });
});

describe("syncBoundTextOrigins", () => {
  it("centers stored x/y on the anchor so persist == paint", () => {
    const els: ExcalidrawElement[] = [
      rect("s"),
      { ...text("t", { containerId: "s" }), x: 999, y: 999 },
    ];
    const out = syncBoundTextOrigins(els);
    const t = out.find((el) => el.id === "t");
    if (!t || t.type !== "text") throw new Error("expected text");
    const box = getTextBounds(els, els[1] as ExcalidrawTextElement);
    expect(t.x).toBeCloseTo(box.minX, 5);
    expect(t.y).toBeCloseTo(box.minY, 5);
  });

  it("returns the input when already synced, leaves free text alone", () => {
    const synced: ExcalidrawElement[] = [rect("s"), text("t", { containerId: "s", x: 0, y: 0 })];
    const once = syncBoundTextOrigins(synced);
    expect(syncBoundTextOrigins(once)).toBe(once);
    const free: ExcalidrawElement[] = [{ ...text("f"), x: 7, y: 9 }];
    expect(syncBoundTextOrigins(free)).toBe(free);
  });

  it("reports wrap widths for bound vs free text", () => {
    const els: ExcalidrawElement[] = [rect("s"), text("t", { containerId: "s" })];
    const bound = els[1] as ExcalidrawTextElement;
    expect(textWrapWidth(els, bound)).toBeGreaterThan(0);
    const free = text("f", { width: 0, autoResize: true });
    expect(textWrapWidth([free], free)).toBeNull();
  });
});

describe("frame labels", () => {
  it("maps group labels to frame names", () => {
    const frame = newElement("frame", { id: "f", x: 0, y: 0, width: 200, height: 200, name: "Group A" });
    const els: ExcalidrawElement[] = [frame, rect("s")];
    expect(frameLabel(els, "f")).toBe("Group A");
    expect(frameLabel(els, "ghost")).toBeNull();
    expect(frameLabel(els, "s")).toBeNull();
  });
});
