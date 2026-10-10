import { describe, it, expect } from "vitest";
import {
  encodeWhiteboardData,
  MAX_ELEMENTS,
  MAX_JSON_BYTES,
  parseElements,
  parseWhiteboardData,
} from "./serialize";
import { emptyScene, newElement } from "./excalidrawDefaults";
import type { ExcalidrawScene } from "./excalidrawTypes";

describe("parseWhiteboardData", () => {
  it("returns an empty scene for missing/corrupt payloads", () => {
    const raws = [null, undefined, "", "not json", '"just a string"', "[unclosed"];
    for (const raw of raws) {
      expect(parseWhiteboardData(raw).elements).toEqual([]);
    }
  });

  it("wipes legacy v1-v5 boards (dev-mode, no migration)", () => {
    const legacy = JSON.stringify({
      version: 5,
      elements: [
        {
          id: "a",
          kind: "rectangle",
          color: "#ef4444",
          strokeWidth: 4,
          start: { x: 0, y: 0 },
          end: { x: 10, y: 10 },
        },
        {
          id: "b",
          kind: "arrow",
          color: "#e5e5e5",
          strokeWidth: 2,
          start: { x: 0, y: 0 },
          end: { x: 20, y: 20 },
        },
        {
          id: "c",
          kind: "text",
          color: "#e5e5e5",
          strokeWidth: 2,
          position: { x: 1, y: 2 },
          text: "hi",
          fontSize: 14,
        },
      ],
    });
    const parsed = parseWhiteboardData(legacy);
    expect(parsed.type).toBe("excalidraw");
    expect(parsed.version).toBe(2);
    expect(parsed.elements).toEqual([]);
  });

  it("rejects unknown scene versions instead of migrating", () => {
    const raw = JSON.stringify({ type: "excalidraw", version: 99, elements: [] });
    expect(parseWhiteboardData(raw).elements).toEqual([]);
  });

  it("accepts bare elements[] arrays (clipboard pastes)", () => {
    const rect = newElement("rectangle", { x: 1, y: 2, width: 30, height: 40 });
    const parsed = parseWhiteboardData(JSON.stringify([rect, { type: "spaceship" }]));
    expect(parsed.type).toBe("excalidraw");
    expect(parsed.elements).toEqual([rect]);
  });

  it("drops malformed elements but keeps valid ones", () => {
    const line = newElement("line", { points: [[0, 0], [5, 5]] });
    const raw = JSON.stringify({
      type: "excalidraw",
      version: 2,
      elements: [{ type: "rectangle" }, { id: "x", kind: "line" }, line],
    });
    expect(parseWhiteboardData(raw).elements).toEqual([line]);
  });
});

describe("parseElements", () => {
  it("caps at MAX_ELEMENTS", () => {
    const raw = Array.from({ length: MAX_ELEMENTS + 50 }, (_, i) => ({
      type: "rectangle",
      id: `e${i}`,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    }));
    expect(parseElements(raw)).toHaveLength(MAX_ELEMENTS);
  });

  it("returns [] for non-arrays", () => {
    expect(parseElements(null)).toEqual([]);
    expect(parseElements({})).toEqual([]);
  });
});

describe("encodeWhiteboardData", () => {
  it("round-trips byte-identical through parse", () => {
    const scene: ExcalidrawScene = {
      ...emptyScene(),
      elements: [
        newElement("rectangle", { x: 1, y: 2, width: 30, height: 40 }),
        newElement("ellipse", { x: 5, y: 5, width: 10, height: 10 }),
        newElement("diamond", { x: 0, y: 0, width: 8, height: 8 }),
        newElement("arrow", { points: [[0, 0], [60, 0]] }),
        newElement("line", { points: [[0, 0], [60, 0]] }),
        newElement("freedraw", {
          points: [[0, 0], [1, 1], [2, 0]],
          pressures: [0.5, 0.6, 0.5],
        }),
        newElement("text", { x: 3, y: 4, text: "hi" }),
        newElement("image", { x: 0, y: 0, width: 64, height: 64 }),
        newElement("frame", { x: 0, y: 0, width: 200, height: 200, name: "Frame" }),
      ],
    };
    const json = encodeWhiteboardData(scene);
    expect(json).not.toBeNull();
    expect(parseWhiteboardData(json)).toEqual(scene);
    expect(encodeWhiteboardData(parseWhiteboardData(json))).toBe(json);
  });

  it("shrinks oversized freedraw payloads under the byte budget", () => {
    const points = Array.from({ length: 20_000 }, (_, i) => [i, i % 100]) as [number, number][];
    const scene: ExcalidrawScene = {
      ...emptyScene(),
      elements: [newElement("freedraw", { points, pressures: points.map(() => 0.5) })],
    };
    const json = encodeWhiteboardData(scene);
    expect(json).not.toBeNull();
    expect((json as string).length).toBeLessThanOrEqual(MAX_JSON_BYTES);
    const [el] = parseWhiteboardData(json).elements;
    if (el?.type !== "freedraw") throw new Error("expected freedraw element");
    expect(el.points.length).toBe(el.pressures.length);
    expect(el.points.length).toBeGreaterThan(0);
  });
});
