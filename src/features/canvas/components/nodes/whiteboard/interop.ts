import { isRecord } from "~/lib/guards";
import { createElementId, emptyScene } from "./excalidrawDefaults";
import {
  ExcalidrawAppStateSchema,
  ExcalidrawElementSchema,
  type ExcalidrawAppState,
  type ExcalidrawElement,
  type ExcalidrawFiles,
  type ExcalidrawScene,
} from "./excalidrawTypes";
import { MAX_ELEMENTS, parseElements } from "./serialize";

/**
 * Phase 4 import side (whiteboard-excalidraw-parity steps 21-22): parse
 * excalidraw.com payloads (full scene, bare `elements[]`, `excalidrawlib`
 * libraries, clipboard `{elements,…}` wrappers), Zod-validate, mint fresh
 * `versionNonce`s, merge with id-collision remap, and cap the `files` map at
 * 5 MB. Export side lives in `./interopExport`, legacy conversion in
 * `./interopConvert` (board stays legacy until Phase 5).
 */

/** Total image payload we keep per scene; beyond this files drop with a warning. */
export const MAX_INTEROP_FILES_BYTES = 5_000_000;
export const INTEROP_EXPORT_PAD = 24;

function randomNonce(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

function withFreshNonce(el: ExcalidrawElement): ExcalidrawElement {
  return { ...el, versionNonce: randomNonce() };
}

export interface ImportParse {
  elements: ExcalidrawElement[];
  files: ExcalidrawFiles;
  appState: ExcalidrawAppState;
  /** Distinct unknown/unsupported `type` values that were dropped. */
  skippedTypes: string[];
  /** Image files dropped (cap or bad shape) — UI warns to downscale. */
  filesSkipped: number;
  filesOversize: boolean;
  source: "scene" | "elements" | "library" | "none";
}

/** Distinct `type` names of raw items that failed element validation. */
function skippedTypeNames(rawItems: unknown[]): string[] {
  const names = new Set<string>();
  const parsedIds = new Set(parseElements(rawItems).map((el) => el.id));
  for (const item of rawItems) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === "string" ? item.id : null;
    if (id !== null && parsedIds.has(id)) continue;
    if (typeof item.type === "string") names.add(item.type.slice(0, 32));
    else names.add("(missing type)");
    if (names.size >= 12) break;
  }
  return [...names];
}

function parseRawElements(raw: unknown): { elements: ExcalidrawElement[]; skippedTypes: string[] } {
  const items = Array.isArray(raw) ? raw.slice(0, MAX_ELEMENTS) : [];
  const elements = parseElements(items).map(withFreshNonce);
  return { elements, skippedTypes: skippedTypeNames(items) };
}

export interface ValidatedFiles {
  files: ExcalidrawFiles;
  skippedFiles: number;
  /** True when the 5 MB cap dropped files (UI warns to downscale). */
  oversize: boolean;
}

/** Keep `fileId -> {mimeType, dataURL}` entries under the total byte cap. */
export function validateFiles(raw: unknown): ValidatedFiles {
  const empty: ValidatedFiles = { files: {}, skippedFiles: 0, oversize: false };
  if (!isRecord(raw)) return empty;
  const files: ExcalidrawFiles = {};
  let bytes = 0;
  let skippedFiles = 0;
  let capSkipped = 0;
  for (const [fileId, entry] of Object.entries(raw)) {
    if (!isRecord(entry)) {
      skippedFiles += 1;
      continue;
    }
    const mimeType = entry.mimeType;
    const dataURL = entry.dataURL;
    if (typeof mimeType !== "string" || typeof dataURL !== "string") {
      skippedFiles += 1;
      continue;
    }
    if (!dataURL.startsWith("data:")) {
      skippedFiles += 1;
      continue;
    }
    if (bytes + dataURL.length > MAX_INTEROP_FILES_BYTES) {
      skippedFiles += 1;
      capSkipped += 1;
      continue;
    }
    bytes += dataURL.length;
    files[fileId] = { mimeType, dataURL };
  }
  return { files, skippedFiles, oversize: capSkipped > 0 };
}

function parseAppState(raw: unknown): ExcalidrawAppState {
  const parsed = ExcalidrawAppStateSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return { viewBackgroundColor: "#ffffff", gridSize: null };
}

function libraryElements(value: Record<string, unknown>): unknown[] {
  const items = value.libraryItems;
  const legacy = value.library;
  let list: unknown = [];
  if (Array.isArray(items)) list = items;
  else if (Array.isArray(legacy)) list = legacy;
  const out: unknown[] = [];
  if (!Array.isArray(list)) return out;
  for (const item of list) {
    if (!isRecord(item)) continue;
    if (Array.isArray(item.elements)) out.push(...item.elements);
  }
  return out;
}

/**
 * Parse pasted/dropped text: full v2 scene, bare `elements[]`,
 * `excalidrawlib` libraries, or clipboard `{elements, appState?, files?}`
 * wrappers. Anything else yields an empty `none` parse (never throws).
 */
export function parseImportPayload(text: string): ImportParse {
  const fallback: ImportParse = {
    elements: [],
    files: {},
    appState: parseAppState(undefined),
    skippedTypes: [],
    filesSkipped: 0,
    filesOversize: false,
    source: "none",
  };
  if (typeof text !== "string" || text.length === 0) return fallback;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return fallback;
  }
  if (Array.isArray(value)) {
    const { elements, skippedTypes } = parseRawElements(value);
    return { ...fallback, elements, skippedTypes, source: "elements" };
  }
  if (!isRecord(value)) return fallback;
  if (value.type === "excalidrawlib") {
    const { elements, skippedTypes } = parseRawElements(libraryElements(value));
    return { ...fallback, elements, skippedTypes, source: "library" };
  }  if (value.type === "excalidraw") {
    const { elements, skippedTypes } = parseRawElements(value.elements);
    const validated = validateFiles(value.files);
    return {
      elements,
      files: validated.files,
      appState: parseAppState(value.appState),
      skippedTypes,
      filesSkipped: validated.skippedFiles,
      filesOversize: validated.oversize,
      source: "scene",
    };
  }
  if (Array.isArray(value.elements)) {
    const { elements, skippedTypes } = parseRawElements(value.elements);
    const validated = validateFiles(value.files);
    return {
      elements,
      files: validated.files,
      appState: parseAppState(value.appState),
      skippedTypes,
      filesSkipped: validated.skippedFiles,
      filesOversize: validated.oversize,
      source: "scene",
    };
  }
  return fallback;
}

export interface MergeSummary {
  addedIds: string[];
  remappedIds: number;
  skippedTypes: string[];
}

/**
 * Append parsed elements to a scene: colliding ids get fresh ones (with
 * `containerId`/`boundElements`/`frameId`/binding refs remapped) and every
 * imported element keeps its fresh `versionNonce`. Merging into an empty
 * board (file open) also adopts the incoming `appState`; pasting into a
 * non-empty board keeps the board's canvas settings.
 */
export function mergeImport(
  scene: ExcalidrawScene,
  parsed: ImportParse,
): { scene: ExcalidrawScene; summary: MergeSummary } {
  const taken = new Set(scene.elements.map((el) => el.id));
  const idMap = new Map<string, string>();
  for (const el of parsed.elements) {
    if (taken.has(el.id)) {
      idMap.set(el.id, createElementId());
      taken.add(idMap.get(el.id) as string);
    } else {
      taken.add(el.id);
    }
  }
  const remap = (id: string): string => idMap.get(id) ?? id;
  const elements = parsed.elements.map((el) => {
    const next = { ...el, id: remap(el.id) };
    if (next.type === "text" && next.containerId !== null) {
      next.containerId = remap(next.containerId);
    }
    if (next.type === "frame") return next;
    if (next.type === "image" && next.fileId !== null) return next;
    if (next.type === "arrow" || next.type === "line") {
      if (next.startBinding) next.startBinding = { ...next.startBinding, elementId: remap(next.startBinding.elementId) };
      if (next.endBinding) next.endBinding = { ...next.endBinding, elementId: remap(next.endBinding.elementId) };
    }
    if (next.frameId !== null) next.frameId = remap(next.frameId);
    if (next.boundElements) {
      next.boundElements = next.boundElements.map((b) => ({ ...b, id: remap(b.id) }));
    }
    return next;
  });
  const files = { ...scene.files, ...parsed.files };
  const addedIds = elements.map((el) => el.id);
  const appState = scene.elements.length === 0 ? parsed.appState : scene.appState;
  return {
    scene: {
      ...scene,
      elements: [...scene.elements, ...elements].slice(0, MAX_ELEMENTS),
      files,
      appState,
    },
    summary: { addedIds, remappedIds: idMap.size, skippedTypes: parsed.skippedTypes },
  };
}

/** Empty-scene helper for drop/paste targets that only need validation. */
export function emptyImportTarget() {
  return emptyScene();
}

export { ExcalidrawElementSchema };
