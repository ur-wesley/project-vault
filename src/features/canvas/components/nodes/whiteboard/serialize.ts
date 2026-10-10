import { isRecord } from "~/lib/guards";
import { emptyScene } from "./excalidrawDefaults";
import {
  ExcalidrawElementSchema,
  ExcalidrawSceneSchema,
  type ExcalidrawElement,
  type ExcalidrawFreedrawElement,
  type ExcalidrawScene,
} from "./excalidrawTypes";

/** Hard caps so one whiteboard can't blow up the persisted layout. */
export const MAX_ELEMENTS = 2000;
export const MAX_JSON_BYTES = 200_000;

function parseElement(raw: unknown): ExcalidrawElement | null {
  const parsed = ExcalidrawElementSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return null;
}

/** Validate elements one by one: unknown types/shapes drop, valid ones stay. */
export function parseElements(raw: unknown): ExcalidrawElement[] {
  if (!Array.isArray(raw)) return [];
  const out: ExcalidrawElement[] = [];
  for (const item of raw) {
    const el = parseElement(item);
    if (el) out.push(el);
    if (out.length >= MAX_ELEMENTS) break;
  }
  return out;
}

/**
 * Parse a native Excalidraw v2 scene. Accepts full scenes
 * (`{ type: "excalidraw", version: 2, elements, … }`) and bare `elements[]`
 * arrays (clipboard pastes). Anything else — including legacy v1–v5 boards,
 * which fail element validation — loads as an empty scene (dev-mode wipe, no
 * migration by design).
 */
export function parseWhiteboardData(raw: string | null | undefined): ExcalidrawScene {
  const fallback = emptyScene();
  if (typeof raw !== "string" || raw.length === 0) return fallback;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (Array.isArray(value)) return { ...fallback, elements: parseElements(value) };
  if (!isRecord(value)) return fallback;
  const wrapper = ExcalidrawSceneSchema.safeParse(value);
  if (!wrapper.success) return fallback;
  return { ...wrapper.data, elements: parseElements(wrapper.data.elements) };
}

function thinFreedraw(el: ExcalidrawFreedrawElement, stride: number): ExcalidrawFreedrawElement {
  return {
    ...el,
    points: el.points.filter((_, i) => i % stride === 0),
    pressures: el.pressures.filter((_, i) => i % stride === 0),
  };
}

/** Encode a scene, thinning freedraw density until it fits the byte budget. */
export function encodeWhiteboardData(scene: ExcalidrawScene): string | null {
  const trimmed: ExcalidrawScene = { ...scene, elements: scene.elements.slice(0, MAX_ELEMENTS) };
  let json = JSON.stringify(trimmed);
  let stride = 2;
  while (json.length > MAX_JSON_BYTES && stride <= 16) {
    const thinned = trimmed.elements.map((el) =>
      el.type === "freedraw" ? thinFreedraw(el, stride) : el,
    );
    json = JSON.stringify({ ...trimmed, elements: thinned });
    stride *= 2;
  }
  return json;
}
