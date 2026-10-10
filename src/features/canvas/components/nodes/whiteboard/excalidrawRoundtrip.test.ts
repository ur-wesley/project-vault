import { describe, it, expect } from "vitest";
import { emptyScene, newElement } from "./excalidrawDefaults";
import type { ExcalidrawElement, ExcalidrawScene } from "./excalidrawTypes";
import { encodeWhiteboardData, parseWhiteboardData } from "./serialize";
import { syncBoundTextOrigins, getTextBounds } from "./boundText";
import type { ExcalidrawTextElement } from "./excalidrawTypes";

/**
 * Excalidraw v2 round-trips: what the board persists must reload
 * byte-identical, and exports must open on excalidraw.com exactly as
 * painted here. Legacy/custom payloads wipe to an empty scene by design
 * (dev-mode: no migration, no schema freeze).
 */

function stableScene(): ExcalidrawScene {
  const rect = newElement("rectangle", {
    id: "r1",
    x: 100,
    y: 100,
    width: 200,
    height: 120,
    strokeColor: "#1e1e1e",
    backgroundColor: "#ffc9c9",
    fillStyle: "solid",
    roughness: 1,
    seed: 11,
    versionNonce: 111,
  });
  const arrow = newElement("arrow", {
    id: "a1",
    x: 300,
    y: 160,
    width: 100,
    height: 20,
    points: [
      [0, 0],
      [100, 20],
    ],
    seed: 33,
    versionNonce: 333,
  });
  const label = newElement("text", {
    id: "l1",
    x: 0,
    y: 0,
    text: "Hello",
    fontSize: 20,
    fontFamily: 2,
    containerId: "r1",
    seed: 44,
    versionNonce: 444,
  }) as ExcalidrawTextElement;
  const frame = newElement("frame", {
    id: "f1",
    x: 0,
    y: 0,
    width: 600,
    height: 400,
    name: "Frame 1",
    seed: 55,
    versionNonce: 555,
  });
  const grouped = newElement("rectangle", {
    id: "g1",
    x: 40,
    y: 40,
    width: 120,
    height: 80,
    groupIds: ["g"],
    frameId: "f1",
    seed: 66,
    versionNonce: 666,
  });
  const elements = syncBoundTextOrigins([rect, arrow, label, frame, grouped]);
  return {
    ...emptyScene(),
    elements,
    appState: { viewBackgroundColor: "#f8f9fa", gridSize: 20 },
  };
}

describe("persist round-trip", () => {
  it("encode -> parse is byte-stable (seeds, nonces, appState)", () => {
    const scene = stableScene();
    const json = encodeWhiteboardData(scene);
    expect(typeof json).toBe("string");
    const back = parseWhiteboardData(json);
    expect(back).toEqual(scene);
    // Second cycle is fixed-point stable.
    expect(parseWhiteboardData(encodeWhiteboardData(back))).toEqual(scene);
  });

  it("round-trips image elements with their files map", () => {
    const img = newElement("image", { id: "img1", x: 5, y: 5, width: 8, height: 8 });
    const scene: ExcalidrawScene = {
      ...emptyScene(),
      elements: [img],
      files: { "file-1": { mimeType: "image/png", dataURL: "data:image/png;base64,AAA" } },
    };
    const back = parseWhiteboardData(encodeWhiteboardData(scene));
    expect(back.elements).toHaveLength(1);
    expect(back.files).toEqual(scene.files);
  });

  it("preserves versionNonce through persist (only imports mint fresh)", () => {
    const scene = stableScene();
    const back = parseWhiteboardData(encodeWhiteboardData(scene));
    const nonces = (els: ExcalidrawElement[]) => els.map((el) => el.versionNonce);
    expect(nonces(back.elements)).toEqual(nonces(scene.elements));
  });
});

describe("bound-label sync stability", () => {
  it("sync -> persist -> parse keeps labels centered on their anchor", () => {
    const scene = stableScene();
    const label = scene.elements.find((el) => el.id === "l1");
    if (!label || label.type !== "text") throw new Error("expected label");
    const box = getTextBounds(scene.elements, label);
    expect(label.x).toBeCloseTo(box.minX, 5);
    expect(label.y).toBeCloseTo(box.minY, 5);
    // Re-sync after a container move re-centers (no drift accumulation).
    const moved = scene.elements.map((el) =>
      el.id === "r1" ? { ...el, x: 200, y: 200 } : el,
    );
    const resynced = syncBoundTextOrigins(moved);
    const label2 = resynced.find((el) => el.id === "l1");
    if (!label2 || label2.type !== "text") throw new Error("expected label");
    const box2 = getTextBounds(resynced, label2);
    expect(label2.x).toBeCloseTo(box2.minX, 5);
    expect(syncBoundTextOrigins(resynced)).toBe(resynced);
  });
});

describe("dev-mode wipe (no migration)", () => {
  it("loads legacy custom boards as an empty scene", () => {
    const legacy = JSON.stringify({
      version: 5,
      elements: [
        { id: "a", kind: "rectangle", start: { x: 0, y: 0 }, end: { x: 5, y: 5 } },
      ],
    });
    const back = parseWhiteboardData(legacy);
    expect(back.elements).toEqual([]);
    expect(back.type).toBe("excalidraw");
  });

  it("rejects garbage, null, and wrong versions", () => {
    expect(parseWhiteboardData(null).elements).toEqual([]);
    expect(parseWhiteboardData("not json").elements).toEqual([]);
    expect(parseWhiteboardData(JSON.stringify({ type: "excalidraw", version: 99, elements: [] })).elements).toEqual([]);
  });

  it("accepts bare elements[] (clipboard pastes)", () => {
    const scene = stableScene();
    const raw = JSON.stringify(scene.elements);
    expect(parseWhiteboardData(raw).elements).toEqual(scene.elements);
  });
});
