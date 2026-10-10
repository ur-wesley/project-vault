import { describe, it, expect } from "vitest";
import { emptyScene } from "./excalidrawDefaults";
import type { ExcalidrawElement, ExcalidrawScene } from "./excalidrawTypes";
import {
  MAX_INTEROP_FILES_BYTES,
  mergeImport,
  parseImportPayload,
  validateFiles,
} from "./interop";
import {
  exportSceneJson,
  exportSceneSvg,
  paintSceneOnCanvas,
  pngExportSize,
  sceneBounds,
} from "./interopExport";

function stubCtx() {
  const canvas = { width: 800, height: 600 };
  const ctx = new Proxy(
    { canvas },
    {
      get(_target, prop: string) {
        if (prop === "canvas") return canvas;
        return () => undefined;
      },
      set() {
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return ctx;
}

/** Drop volatile ids so import->export round-trips compare diff-clean. */
function normalize(elements: ExcalidrawElement[]) {
  return elements.map((el) => ({ ...el, versionNonce: 0 }));
}

/* ------------------------------------------------------------------ */
/* Fixtures: shaped like real excalidraw.com v2 exports.                */
/* ------------------------------------------------------------------ */

const SHAPES_SCENE = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "https://excalidraw.com",
  elements: [
    {
      id: "rect1",
      type: "rectangle",
      x: 100,
      y: 100,
      width: 200,
      height: 120,
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: "#ffc9c9",
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      index: "a0",
      roundness: { type: 3 },
      boundElements: [{ type: "text", id: "label1" }],
      link: null,
      locked: false,
      seed: 11,
      version: 3,
      versionNonce: 111,
      isDeleted: false,
    },
    {
      id: "ellipse1",
      type: "ellipse",
      x: 400,
      y: 120,
      width: 160,
      height: 100,
      angle: 0,
      strokeColor: "#1971c2",
      backgroundColor: "transparent",
      fillStyle: "transparent",
      strokeWidth: 2,
      strokeStyle: "dashed",
      roughness: 2,
      opacity: 100,
      groupIds: [],
      frameId: null,
      index: "a1",
      roundness: { type: 2 },
      boundElements: [],
      link: null,
      locked: false,
      seed: 22,
      version: 1,
      versionNonce: 222,
      isDeleted: false,
    },
    {
      id: "arrow1",
      type: "arrow",
      x: 300,
      y: 160,
      width: 100,
      height: 20,
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "transparent",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      index: "a2",
      roundness: { type: 2 },
      boundElements: [],
      link: null,
      locked: false,
      seed: 33,
      version: 1,
      versionNonce: 333,
      isDeleted: false,
      points: [
        [0, 0],
        [100, 20],
      ],
      startBinding: null,
      endBinding: null,
      startArrowhead: null,
      endArrowhead: "arrow",
      elbowed: false,
    },
    {
      id: "label1",
      type: "text",
      x: 150,
      y: 140,
      width: 100,
      height: 25,
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "transparent",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 0,
      opacity: 100,
      groupIds: [],
      frameId: null,
      index: "a3",
      roundness: null,
      boundElements: [],
      link: null,
      locked: false,
      seed: 44,
      version: 2,
      versionNonce: 444,
      isDeleted: false,
      text: "Hello",
      fontSize: 20,
      fontFamily: 2,
      textAlign: "center",
      verticalAlign: "middle",
      containerId: "rect1",
      originalText: "Hello",
      autoResize: true,
      lineHeight: 1.25,
    },
  ],
  appState: { viewBackgroundColor: "#ffffff", gridSize: null },
  files: {},
});

const FRAME_SCENE = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "https://excalidraw.com",
  elements: [
    {
      id: "frame1",
      type: "frame",
      x: 0,
      y: 0,
      width: 600,
      height: 400,
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "transparent",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 0,
      opacity: 100,
      groupIds: [],
      frameId: null,
      index: "a0",
      roundness: null,
      boundElements: [],
      link: null,
      locked: false,
      seed: 55,
      version: 1,
      versionNonce: 555,
      isDeleted: false,
      name: "Frame 1",
    },
    {
      id: "grect1",
      type: "rectangle",
      x: 40,
      y: 40,
      width: 120,
      height: 80,
      angle: 0,
      strokeColor: "#2b8a3e",
      backgroundColor: "transparent",
      fillStyle: "hachure",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: ["g1"],
      frameId: "frame1",
      index: "a1",
      roundness: { type: 3 },
      boundElements: [],
      link: null,
      locked: false,
      seed: 66,
      version: 1,
      versionNonce: 666,
      isDeleted: false,
    },
    {
      id: "grect2",
      type: "rectangle",
      x: 200,
      y: 40,
      width: 120,
      height: 80,
      angle: 0,
      strokeColor: "#2b8a3e",
      backgroundColor: "transparent",
      fillStyle: "hachure",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: ["g1"],
      frameId: "frame1",
      index: "a2",
      roundness: { type: 3 },
      boundElements: [],
      link: null,
      locked: false,
      seed: 77,
      version: 1,
      versionNonce: 777,
      isDeleted: false,
    },
    {
      id: "free1",
      type: "freedraw",
      x: 40,
      y: 200,
      width: 160,
      height: 60,
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "transparent",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: "frame1",
      index: "a3",
      roundness: null,
      boundElements: [],
      link: null,
      locked: false,
      seed: 88,
      version: 1,
      versionNonce: 888,
      isDeleted: false,
      points: [
        [0, 0],
        [40, 30],
        [80, 10],
        [160, 60],
      ],
      pressures: [0.5, 0.6, 0.5, 0.4],
      simulatePressure: true,
    },
  ],
  appState: { viewBackgroundColor: "#f8f9fa", gridSize: 20 },
  files: {},
});

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const IMAGE_SCENE = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "https://excalidraw.com",
  elements: [
    {
      id: "img1",
      type: "image",
      x: 50,
      y: 50,
      width: 64,
      height: 64,
      angle: 0,
      strokeColor: "transparent",
      backgroundColor: "transparent",
      fillStyle: "transparent",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 0,
      opacity: 100,
      groupIds: [],
      frameId: null,
      index: "a0",
      roundness: null,
      boundElements: [],
      link: null,
      locked: false,
      seed: 99,
      version: 1,
      versionNonce: 999,
      isDeleted: false,
      fileId: "file-abc",
      scale: [1, 1],
    },
  ],
  appState: { viewBackgroundColor: "#ffffff", gridSize: null },
  files: { "file-abc": { mimeType: "image/png", dataURL: TINY_PNG } },
});

describe("parseImportPayload", () => {
  it("parses full scenes with no skipped types", () => {
    const parsed = parseImportPayload(SHAPES_SCENE);
    expect(parsed.source).toBe("scene");
    expect(parsed.elements).toHaveLength(4);
    expect(parsed.skippedTypes).toEqual([]);
    expect(parsed.appState.viewBackgroundColor).toBe("#ffffff");
  });

  it("accepts bare elements[] arrays (clipboard pastes)", () => {
    const raw = JSON.stringify(JSON.parse(SHAPES_SCENE).elements);
    const parsed = parseImportPayload(raw);
    expect(parsed.source).toBe("elements");
    expect(parsed.elements).toHaveLength(4);
  });

  it("accepts clipboard {elements, appState} wrappers", () => {
    const scene = JSON.parse(SHAPES_SCENE) as { elements: unknown; appState: unknown };
    const parsed = parseImportPayload(JSON.stringify({ elements: scene.elements, appState: scene.appState }));
    expect(parsed.source).toBe("scene");
    expect(parsed.elements).toHaveLength(4);
    expect(parsed.appState.viewBackgroundColor).toBe("#ffffff");
  });

  it("flattens excalidrawlib libraries", () => {
    const scene = JSON.parse(SHAPES_SCENE) as { elements: unknown[] };
    const lib = JSON.stringify({
      type: "excalidrawlib",
      version: 2,
      libraryItems: [
        { id: "lib1", status: "published", elements: scene.elements.slice(0, 2), created: 1 },
        { id: "lib2", status: "published", elements: scene.elements.slice(2), created: 2 },
      ],
    });
    const parsed = parseImportPayload(lib);
    expect(parsed.source).toBe("library");
    expect(parsed.elements).toHaveLength(4);
  });

  it("drops unknown types and reports them", () => {
    const raw = JSON.stringify([
      { type: "rectangle", id: "ok", x: 0, y: 0, width: 10, height: 10 },
      { type: "embeddable", id: "nope" },
      { type: "magicframe", id: "nope2" },
      { id: "typeless" },
    ]);
    const parsed = parseImportPayload(raw);
    expect(parsed.elements).toHaveLength(1);
    expect(parsed.skippedTypes).toContain("embeddable");
    expect(parsed.skippedTypes).toContain("magicframe");
  });

  it("mints fresh versionNonce values on import", () => {
    const parsed = parseImportPayload(SHAPES_SCENE);
    const rawNonces = [111, 222, 333, 444];
    for (const [i, el] of parsed.elements.entries()) {
      expect(Number.isFinite(el.versionNonce)).toBe(true);
      expect(el.versionNonce).not.toBe(rawNonces[i]);
    }
  });

  it("returns an empty none-parse for garbage", () => {
    for (const bad of ["", "not json", '{"type":"nope"}', "[unclosed"]) {
      const parsed = parseImportPayload(bad);
      expect(parsed.source).toBe("none");
      expect(parsed.elements).toEqual([]);
    }
  });
});

describe("validateFiles", () => {
  it("keeps image fileId entries", () => {
    const parsed = parseImportPayload(IMAGE_SCENE);
    expect(parsed.files["file-abc"]?.mimeType).toBe("image/png");
    expect(parsed.files["file-abc"]?.dataURL).toBe(TINY_PNG);
  });

  it("caps the files map at 5 MB with an oversize warning", () => {
    const big = `data:image/png;base64,${"A".repeat(MAX_INTEROP_FILES_BYTES)}`;
    const result = validateFiles({ "big-file": { mimeType: "image/png", dataURL: big } });
    expect(result.files["big-file"]).toBeUndefined();
    expect(result.skippedFiles).toBe(1);
    expect(result.oversize).toBe(true);
  });

  it("drops malformed file entries", () => {
    const result = validateFiles({
      ok: { mimeType: "image/png", dataURL: TINY_PNG },
      bad: { mimeType: "image/png" },
      evil: { mimeType: "image/png", dataURL: "https://example.com/x.png" },
    });
    expect(Object.keys(result.files)).toEqual(["ok"]);
    expect(result.skippedFiles).toBe(2);
    expect(result.oversize).toBe(false);
  });
});

describe("mergeImport", () => {
  it("appends elements and remaps colliding ids with refs", () => {
    const base = emptyScene();
    const first = parseImportPayload(SHAPES_SCENE);
    const merged = mergeImport(base, first);
    expect(merged.summary.addedIds).toHaveLength(4);
    expect(merged.summary.remappedIds).toBe(0);

    const again = mergeImport(merged.scene, parseImportPayload(SHAPES_SCENE));
    expect(again.summary.remappedIds).toBe(4);
    const ids = new Set(again.scene.elements.map((el) => el.id));
    expect(ids.size).toBe(8);
    const texts = again.scene.elements.filter((el) => el.type === "text");
    expect(texts).toHaveLength(2);
    for (const t of texts) {
      if (t.type !== "text") continue;
      expect(ids.has(t.containerId ?? "")).toBe(true);
    }
  });
});

describe("fixture round-trips (step 23)", () => {
  const fixtures: [string, string][] = [
    ["shapes+arrows+text", SHAPES_SCENE],
    ["frame+groups", FRAME_SCENE],
    ["image", IMAGE_SCENE],
  ];
  for (const [name, raw] of fixtures) {
    it(`${name}: import -> render -> export is diff-clean minus versionNonce`, () => {
      const parsed = parseImportPayload(raw);
      expect(parsed.elements.length).toBeGreaterThan(0);
      const { scene } = mergeImport(emptyScene(), parsed);
      // Render every imported element (throws on corrupt geometry).
      paintSceneOnCanvas(scene, stubCtx());
      // Export and re-parse: identical except fresh versionNonces.
      const exported = JSON.parse(exportSceneJson(scene)) as ExcalidrawScene;
      const original = JSON.parse(raw) as ExcalidrawScene;
      expect(exported.type).toBe("excalidraw");
      expect(exported.version).toBe(2);
      expect(normalize(exported.elements)).toEqual(normalize(original.elements));
      expect(exported.files).toEqual(original.files);
      expect(exported.appState).toEqual(original.appState);
      // SVG covers the scene.
      const svg = exportSceneSvg(scene);
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg).toContain("</svg>");
    });
  }

  it("image fixture SVG embeds the file dataURL", () => {
    const { scene } = mergeImport(emptyScene(), parseImportPayload(IMAGE_SCENE));
    expect(exportSceneSvg(scene)).toContain(TINY_PNG);
  });

  it("frame fixture keeps group + frame membership", () => {
    const { scene } = mergeImport(emptyScene(), parseImportPayload(FRAME_SCENE));
    const grouped = scene.elements.filter((el) => el.groupIds.includes("g1"));
    expect(grouped).toHaveLength(2);
    expect(scene.elements.every((el) => el.frameId === "frame1" || el.id === "frame1")).toBe(true);
    expect(sceneBounds(scene)).not.toBeNull();
    const size = pngExportSize(scene, 2);
    expect(size.width).toBeGreaterThanOrEqual(1);
  });
});
