import { describe, it, expect } from "vitest";
import {
  applyDrawModifiers,
  aspectLockedBox,
  centeredResizeBox,
  getRotateHandle,
  hitTestRotateHandle,
  snapAngle,
  squareDraftEnd,
} from "./geometryEdit";
import {
  createDraftElement,
  duplicateElements,
  expandMoveIds,
  finishDraft,
  nativeTypeFor,
  nudgeElements,
  reorderElements,
  setElementsLink,
  setElementsLocked,
} from "./elementOps";
import { newElement } from "./excalidrawDefaults";
import type { ExcalidrawElement, ExcalidrawTextElement } from "./excalidrawTypes";

function rect(id = "r"): ExcalidrawElement {
  return newElement("rectangle", { id, x: 0, y: 0, width: 50, height: 50 });
}

function textBound(id: string, containerId: string): ExcalidrawTextElement {
  return newElement("text", { id, x: 0, y: 0, text: "label", containerId }) as ExcalidrawTextElement;
}

describe("createDraftElement", () => {
  it("builds collapsed press-point drafts per tool", () => {
    const at = { x: 10, y: 20 };
    const r = createDraftElement("rectangle", at, { strokeColor: "#fff", strokeWidth: 2 });
    expect(r.type).toBe("rectangle");
    expect(r).toMatchObject({ x: 10, y: 20, width: 0, height: 0 });
    const f = createDraftElement("freehand", at, {});
    expect(f.type).toBe("freedraw");
    if (f.type !== "freedraw") throw new Error("expected freedraw");
    expect(f.points).toEqual([[0, 0]]);
    const a = createDraftElement("arrow", at, {});
    expect(a.type).toBe("arrow");
    if (a.type !== "arrow") throw new Error("expected arrow");
    expect(a.startBinding).toBeNull();
    expect(a.endBinding).toBeNull();
    expect(a.endArrowhead).toBe("arrow");
    expect(() => createDraftElement("text", at, {})).toThrow();
  });

  it("maps freehand to freedraw", () => {
    expect(nativeTypeFor("freehand")).toBe("freedraw");
    expect(nativeTypeFor("rectangle")).toBe("rectangle");
  });
});

describe("finishDraft", () => {
  it("drops click-sized shapes, keeps connectors and rebases origins", () => {
    expect(finishDraft(newElement("rectangle", { id: "r", x: 0, y: 0, width: 1, height: 1 }))).toBeNull();
    const conn = newElement("arrow", {
      id: "a",
      x: 50,
      y: 50,
      points: [
        [0, 0],
        [-30, -10],
      ],
    });
    const done = finishDraft(conn);
    if (!done || done.type !== "arrow") throw new Error("expected arrow");
    expect(done.x).toBe(20);
    expect(done.points).toEqual([
      [30, 10],
      [0, 0],
    ]);
  });
});

describe("duplicateElements", () => {
  it("clones with fresh ids, offset, and remapped bound texts", () => {
    const els = [rect("r"), textBound("t", "r")];
    const { elements: next, newIds } = duplicateElements(els, ["r"], 20, 20);
    expect(next.length).toBe(4);
    expect(newIds.length).toBe(2);
    const cloneR = next.find((e) => e.id === newIds[0]);
    expect(cloneR?.type).toBe("rectangle");
    expect(cloneR).toMatchObject({ x: 20, y: 20 });
    const cloneT = next.find((e) => e.id === newIds[1]);
    if (!cloneT || cloneT.type !== "text") throw new Error("expected cloned text");
    expect(cloneT.containerId).toBe(newIds[0]);
  });

  it("detaches bindings whose target was not duplicated", () => {
    const els: ExcalidrawElement[] = [
      rect("s"),
      {
        ...newElement("arrow", {
          id: "a",
          x: 0,
          y: 0,
          points: [
            [0, 0],
            [60, 0],
          ],
        }),
        startBinding: { elementId: "s", gap: 4, focus: 0 },
        endBinding: null,
      } as ExcalidrawElement,
    ];
    const { elements: next, newIds } = duplicateElements(els, ["a"], 5, 5);
    const clone = next.find((e) => e.id === newIds[0]);
    if (!clone || clone.type !== "arrow") throw new Error("expected arrow clone");
    expect(clone.startBinding).toBeNull();
  });

  it("is a no-op for empty selections", () => {
    const els = [rect()];
    const out = duplicateElements(els, []);
    expect(out.elements).toBe(els);
    expect(out.newIds).toEqual([]);
  });
});

describe("reorderElements", () => {
  it("steps forward/backward past one neighbor", () => {
    const els = [rect("a"), rect("b"), rect("c")];
    const fwd = reorderElements(els, ["a"], "forward");
    expect(fwd.map((e) => e.id)).toEqual(["b", "a", "c"]);
    const back = reorderElements(els, ["c"], "backward");
    expect(back.map((e) => e.id)).toEqual(["a", "c", "b"]);
  });

  it("jumps to front/back as a stable partition", () => {
    const els = [rect("a"), rect("b"), rect("c")];
    expect(reorderElements(els, ["a"], "front").map((e) => e.id)).toEqual(["b", "c", "a"]);
    expect(reorderElements(els, ["c"], "back").map((e) => e.id)).toEqual(["c", "a", "b"]);
  });

  it("returns the input when nothing moves", () => {
    const els = [rect("a"), rect("b")];
    expect(reorderElements(els, ["b"], "forward")).toBe(els);
    expect(reorderElements(els, [], "front")).toBe(els);
  });
});

describe("nudgeElements", () => {
  it("shifts unlocked elements and skips locked ones", () => {
    const locked = { ...rect("b"), locked: true };
    const out = nudgeElements([rect("a"), locked], ["a", "b"], 1, 0);
    expect(out.find((e) => e.id === "a")).toMatchObject({ x: 1, y: 0 });
    expect(out.find((e) => e.id === "b")).toEqual(locked);
  });

  it("drags bound labels via their container", () => {
    const els = [rect("s"), textBound("t", "s")];
    const out = nudgeElements(els, ["t"], 4, 6);
    expect(out.find((e) => e.id === "s")).toMatchObject({ x: 4, y: 6 });
  });
});

describe("expandMoveIds", () => {
  it("maps bound-text ids to their container", () => {
    const els = [rect("s"), textBound("t", "s"), textBound("free", "ghost")];
    expect(expandMoveIds(els, ["t"])).toEqual(["s"]);
    expect(expandMoveIds(els, ["free"])).toEqual(["free"]);
    expect(expandMoveIds(els, ["s", "t"])).toEqual(["s"]);
  });
});

describe("setElementsLocked / setElementsLink", () => {
  it("toggles lock and link on the selection only", () => {
    const els = [rect("a"), rect("b")];
    const locked = setElementsLocked(els, ["a"], true);
    expect(locked.find((e) => e.id === "a")?.locked).toBe(true);
    expect(locked.find((e) => e.id === "b")?.locked).toBeFalsy();
    const linked = setElementsLink(els, ["b"], "https://example.com");
    expect(linked.find((e) => e.id === "b")?.link).toBe("https://example.com");
    expect(linked.find((e) => e.id === "a")?.link).toBeFalsy();
  });
});

describe("draw modifiers", () => {
  it("locks squares and centers on Alt", () => {
    expect(squareDraftEnd({ x: 0, y: 0 }, { x: 30, y: 10 })).toEqual({ x: 30, y: 30 });
    const centered = applyDrawModifiers(
      { x: 50, y: 50 },
      { x: 70, y: 60 },
      { square: false, centered: true },
    );
    expect(centered).toEqual({ start: { x: 30, y: 40 }, end: { x: 70, y: 60 } });
    const plain = applyDrawModifiers(
      { x: 0, y: 0 },
      { x: 30, y: 10 },
      { square: true, centered: false },
    );
    expect(plain).toEqual({ start: { x: 0, y: 0 }, end: { x: 30, y: 30 } });
  });

  it("aspect-locks corner resizes and mirrors center resizes", () => {
    const orig = { minX: 0, minY: 0, maxX: 40, maxY: 20 };
    const locked = aspectLockedBox(orig, "se", { x: 80, y: 80 });
    expect((locked.maxX - locked.minX) / (locked.maxY - locked.minY)).toBeCloseTo(2, 5);
    const centered = centeredResizeBox(orig, "e", { x: 50, y: 10 });
    expect(centered.minX).toBeCloseTo(-10, 5);
    expect(centered.maxX).toBeCloseTo(50, 5);
    // Edge handles pass aspect-lock through unchanged.
    const edge = aspectLockedBox(orig, "e", { x: 60, y: 10 });
    expect(edge).toEqual({ minX: 0, minY: 0, maxX: 60, maxY: 20 });
  });
});

describe("rotate handle", () => {
  it("sits above the box and hit-tests with zoom scaling", () => {
    const box = { minX: 0, minY: 40, maxX: 100, maxY: 90 };
    const h = getRotateHandle(box, 1);
    expect(h).toEqual({ x: 50, y: 16 });
    expect(hitTestRotateHandle(box, { x: 50, y: 16 }, 1)).toBe(true);
    expect(hitTestRotateHandle(box, { x: 0, y: 0 }, 1)).toBe(false);
    expect(snapAngle(Math.PI / 7)).toBeCloseTo(Math.PI / 6, 5);
  });
});
