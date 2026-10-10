import { describe, it, expect } from "vitest";
import { createElementId, emptyScene, newElement } from "./excalidrawDefaults";
import { ExcalidrawElementSchema } from "./excalidrawTypes";

describe("createElementId", () => {
  it("returns unique wb- ids", () => {
    const a = createElementId();
    expect(a.startsWith("wb-")).toBe(true);
    expect(createElementId()).not.toBe(a);
  });
});

describe("emptyScene", () => {
  it("returns a fresh excalidraw v2 scene", () => {
    const scene = emptyScene();
    expect(scene).toEqual({
      type: "excalidraw",
      version: 2,
      source: "project-vault",
      elements: [],
      appState: { viewBackgroundColor: "#ffffff", gridSize: null },
      files: {},
    });
    expect(emptyScene()).not.toBe(scene);
  });
});

describe("newElement", () => {
  it("builds schema-valid elements with factory defaults", () => {
    const rect = newElement("rectangle");
    expect(rect.type).toBe("rectangle");
    expect(rect).toMatchObject({
      angle: 0,
      roughness: 1,
      strokeWidth: 2,
      roundness: { type: 3 },
      isDeleted: false,
      version: 1,
    });
    expect(ExcalidrawElementSchema.safeParse(rect).success).toBe(true);
  });

  it("applies roundness per type", () => {
    expect(newElement("diamond").roundness).toEqual({ type: 2 });
    expect(newElement("arrow").roundness).toEqual({ type: 2 });
    expect(newElement("freedraw").roundness).toBeNull();
    expect(newElement("text").roundness).toBeNull();
  });

  it("defaults arrow tips to end-only", () => {
    const arrow = newElement("arrow");
    if (arrow.type !== "arrow") throw new Error("expected arrow element");
    expect(arrow.startArrowhead).toBeNull();
    expect(arrow.endArrowhead).toBe("arrow");
  });

  it("lets patch values win over defaults", () => {
    const rect = newElement("rectangle", { x: 7, strokeWidth: 4, opacity: 50 });
    expect(rect).toMatchObject({ x: 7, strokeWidth: 4, opacity: 50 });
  });

  it("falls back to clean defaults when the patch fails validation", () => {
    const rect = newElement("rectangle", { opacity: 500 });
    expect(rect.type).toBe("rectangle");
    expect(rect.opacity).toBe(100);
    expect(ExcalidrawElementSchema.safeParse(rect).success).toBe(true);
  });
});
