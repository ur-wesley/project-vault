import { z } from "zod";

/**
 * Excalidraw-native whiteboard model (Phase 0 of whiteboard-excalidraw-parity).
 *
 * Canonical element + scene shape, mirroring Excalidraw `.excalidraw` v2 files
 * (`x/y/width/height/angle`, `strokeColor/backgroundColor`, `points` relative
 * for line/arrow/freedraw). `fontFamily`: 1 = hand, 2 = normal, 3 = code.
 *
 * Validation policy: element `type` and field *shapes* are strict (unknown
 * element types are dropped on load); missing scalar fields fall back to
 * neutral defaults so hand-built / clipboard payloads still parse.
 */

/** Scene format version we read and write (mirrors Excalidraw v2 files). */
export const EXCALIDRAW_SCENE_VERSION = 2 as const;
/** `source` stamp written into scenes created by Project Vault. */
export const EXCALIDRAW_SOURCE = "project-vault";

export const ExcalidrawElementTypeSchema = z.enum([
  "rectangle",
  "ellipse",
  "diamond",
  "arrow",
  "line",
  "freedraw",
  "text",
  "image",
  "frame",
]);
export type ExcalidrawElementType = z.infer<typeof ExcalidrawElementTypeSchema>;

/** Relative `[x, y]` point (line/arrow/freedraw store points relative to x/y). */
const excalidrawPointSchema = z.tuple([z.number(), z.number()]);

const roundnessSchema = z
  .object({
    type: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    value: z.number().optional(),
  })
  .nullable();

const boundElementsSchema = z
  .array(z.object({ type: z.union([z.literal("text"), z.literal("arrow")]), id: z.string() }))
  .nullable();

/**
 * Sticky side anchor (our extension — Excalidraw ignores unknown keys, so
 * files stay interoperable). Absent = legacy ray-slide resolve. `focus`/`gap`
 * default so hand-built payloads still parse (same policy as base scalars).
 */
const bindSideSchema = z.enum(["n", "s", "e", "w"]);

const bindingSchema = z
  .object({
    elementId: z.string(),
    focus: z.number().default(0),
    gap: z.number().default(4),
    side: bindSideSchema.optional(),
  })
  .nullable();

const arrowheadSchema = z
  .union([z.literal("arrow"), z.literal("bar"), z.literal("dot"), z.literal("triangle")])
  .nullable();

function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

const baseSchema = z.object({
  id: z.string().min(1).max(128),
  x: z.number().default(0),
  y: z.number().default(0),
  width: z.number().default(0),
  height: z.number().default(0),
  angle: z.number().default(0),
  strokeColor: z.string().default("#1e1e1e"),
  backgroundColor: z.string().default("transparent"),
  fillStyle: z.enum(["transparent", "solid", "hachure", "cross-hatch"]).default("transparent"),
  strokeWidth: z.number().default(2),
  strokeStyle: z.enum(["solid", "dashed", "dotted"]).default("solid"),
  roughness: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(1),
  opacity: z.number().min(0).max(100).default(100),
  groupIds: z.array(z.string()).default(() => []),
  frameId: z.string().nullable().default(null),
  index: z.string().nullable().default(null),
  roundness: roundnessSchema.default(null),
  boundElements: boundElementsSchema.default(null),
  link: z.string().nullable().default(null),
  locked: z.boolean().default(false),
  seed: z.number().default(() => randomSeed()),
  version: z.number().default(1),
  versionNonce: z.number().default(() => randomSeed()),
  isDeleted: z.boolean().default(false),
});

export type ExcalidrawElementBase = z.infer<typeof baseSchema>;

export const ExcalidrawRectangleElementSchema = baseSchema.extend({ type: z.literal("rectangle") });
export type ExcalidrawRectangleElement = z.infer<typeof ExcalidrawRectangleElementSchema>;

export const ExcalidrawEllipseElementSchema = baseSchema.extend({ type: z.literal("ellipse") });
export type ExcalidrawEllipseElement = z.infer<typeof ExcalidrawEllipseElementSchema>;

export const ExcalidrawDiamondElementSchema = baseSchema.extend({ type: z.literal("diamond") });
export type ExcalidrawDiamondElement = z.infer<typeof ExcalidrawDiamondElementSchema>;

const linearExtras = {
  /** Relative polyline; arrow/line need at least one point, freedraw may be empty. */
  points: z.array(excalidrawPointSchema).min(1),
  startBinding: bindingSchema.default(null),
  endBinding: bindingSchema.default(null),
  startArrowhead: arrowheadSchema.default(null),
  endArrowhead: arrowheadSchema.default(null),
  elbowed: z.boolean().default(false),
};

export const ExcalidrawArrowElementSchema = baseSchema.extend(linearExtras).extend({
  type: z.literal("arrow"),
});
export type ExcalidrawArrowElement = z.infer<typeof ExcalidrawArrowElementSchema>;

export const ExcalidrawLineElementSchema = baseSchema.extend(linearExtras).extend({
  type: z.literal("line"),
});
export type ExcalidrawLineElement = z.infer<typeof ExcalidrawLineElementSchema>;

export const ExcalidrawFreedrawElementSchema = baseSchema.extend({
  type: z.literal("freedraw"),
  points: z.array(excalidrawPointSchema).default(() => []),
  pressures: z.array(z.number()).default(() => []),
  simulatePressure: z.boolean().default(true),
});
export type ExcalidrawFreedrawElement = z.infer<typeof ExcalidrawFreedrawElementSchema>;

export const ExcalidrawTextElementSchema = baseSchema.extend({
  type: z.literal("text"),
  text: z.string().default(""),
  fontSize: z.number().min(1).default(20),
  fontFamily: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  textAlign: z.enum(["left", "center", "right"]).default("left"),
  verticalAlign: z.enum(["top", "middle", "bottom"]).default("top"),
  containerId: z.string().nullable().default(null),
  originalText: z.string().default(""),
  autoResize: z.boolean().default(true),
  lineHeight: z.number().default(1.25),
});
export type ExcalidrawTextElement = z.infer<typeof ExcalidrawTextElementSchema>;

export const ExcalidrawImageElementSchema = baseSchema.extend({
  type: z.literal("image"),
  fileId: z.string().nullable().default(null),
  scale: z.tuple([z.number(), z.number()]).default((): [number, number] => [1, 1]),
});
export type ExcalidrawImageElement = z.infer<typeof ExcalidrawImageElementSchema>;

export const ExcalidrawFrameElementSchema = baseSchema.extend({
  type: z.literal("frame"),
  name: z.string().nullable().default(null),
});
export type ExcalidrawFrameElement = z.infer<typeof ExcalidrawFrameElementSchema>;

export const ExcalidrawElementSchema = z.discriminatedUnion("type", [
  ExcalidrawRectangleElementSchema,
  ExcalidrawEllipseElementSchema,
  ExcalidrawDiamondElementSchema,
  ExcalidrawArrowElementSchema,
  ExcalidrawLineElementSchema,
  ExcalidrawFreedrawElementSchema,
  ExcalidrawTextElementSchema,
  ExcalidrawImageElementSchema,
  ExcalidrawFrameElementSchema,
]);
export type ExcalidrawElement = z.infer<typeof ExcalidrawElementSchema>;

export const ExcalidrawAppStateSchema = z.object({
  viewBackgroundColor: z.string().default("#ffffff"),
  gridSize: z.number().nullable().default(null),
});
export type ExcalidrawAppState = z.infer<typeof ExcalidrawAppStateSchema>;

export const ExcalidrawFilesSchema = z.record(
  z.string(),
  z.object({ mimeType: z.string(), dataURL: z.string() }),
);
export type ExcalidrawFiles = z.infer<typeof ExcalidrawFilesSchema>;

/**
 * Scene wrapper (strict `type`/`version`; elements validated one by one in
 * `serialize.ts` so a single bad element drops instead of wiping the board).
 */
export const ExcalidrawSceneSchema = z.object({
  type: z.literal("excalidraw"),
  version: z.literal(EXCALIDRAW_SCENE_VERSION),
  source: z.string().default(EXCALIDRAW_SOURCE),
  elements: z.array(z.unknown()),
  appState: ExcalidrawAppStateSchema.default(() => ({
    viewBackgroundColor: "#ffffff",
    gridSize: null,
  })),
  files: ExcalidrawFilesSchema.default(() => ({})),
});

export interface ExcalidrawScene {
  type: "excalidraw";
  version: typeof EXCALIDRAW_SCENE_VERSION;
  source: string;
  elements: ExcalidrawElement[];
  appState: ExcalidrawAppState;
  files: ExcalidrawFiles;
}
