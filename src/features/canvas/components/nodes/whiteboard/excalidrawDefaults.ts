import {
  EXCALIDRAW_SCENE_VERSION,
  EXCALIDRAW_SOURCE,
  ExcalidrawElementSchema,
  type ExcalidrawElement,
  type ExcalidrawElementType,
  type ExcalidrawScene,
} from "./excalidrawTypes";

/** Stable `wb-…` ids (same format as the legacy whiteboard model). */
export function createElementId(): string {
  return `wb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Fresh empty scene (new object every call — never shared/mutated). */
export function emptyScene(): ExcalidrawScene {
  return {
    type: "excalidraw",
    version: EXCALIDRAW_SCENE_VERSION,
    source: EXCALIDRAW_SOURCE,
    elements: [],
    appState: { viewBackgroundColor: "#ffffff", gridSize: null },
    files: {},
  };
}

/** Patch accepted by {@link newElement}: any subset of the target element minus `type`. */
export type NewElementPatch<T extends ExcalidrawElementType> = Partial<
  Omit<Extract<ExcalidrawElement, { type: T }>, "type">
>;

function defaultRoundnessFor(type: ExcalidrawElementType): ExcalidrawElement["roundness"] {
  if (type === "rectangle") return { type: 3 };
  if (type === "ellipse" || type === "diamond" || type === "arrow" || type === "line") {
    return { type: 2 };
  }
  return null;
}

/** Map the panel roundness toggle onto a type-appropriate roundness object. */
export function roundnessForToggle(
  type: ExcalidrawElementType,
  round: boolean,
): ExcalidrawElement["roundness"] {
  if (!round) return { type: 0 };
  return defaultRoundnessFor(type);
}

/** True when roundness renders rounded corners. */
export function isRoundRoundnessFor(
  roundness: ExcalidrawElement["roundness"],
): boolean {
  return !!roundness && roundness.type !== 0;
}

/**
 * Build a valid element of `type`, applying `patch` over opinionated defaults
 * (`angle 0`, `roughness 1`, `strokeWidth 2`, `isDeleted false`, `version 1`,
 * roundness per type, arrow tip on arrows). Mistyped patch fields are ignored
 * (the patch falls back to bare defaults) rather than producing invalid output.
 *
 * @throws When `type` is not a known element type (unreachable from TypeScript).
 */
export function newElement<T extends ExcalidrawElementType>(
  type: T,
  patch?: NewElementPatch<T>,
): ExcalidrawElement;
export function newElement(
  type: ExcalidrawElementType,
  patch: Record<string, unknown> = {},
): ExcalidrawElement {
  const id =
    typeof patch.id === "string" && patch.id.length > 0 ? patch.id : createElementId();
  const arrowTip = type === "arrow" ? "arrow" : null;
  const candidate = {
    angle: 0,
    strokeColor: "#e5e5e5",
    backgroundColor: "transparent",
    strokeWidth: 2,
    roughness: 1,
    opacity: 100,
    roundness: defaultRoundnessFor(type),
    version: 1,
    isDeleted: false,
    startArrowhead: null,
    endArrowhead: arrowTip,
    ...(type === "arrow" || type === "line" ? { points: [[0, 0], [100, 100]] } : null),
    ...(type === "text" ? { fontSize: 16, fontFamily: 2 } : null),
    ...patch,
    type,
    id,
  };
  const parsed = ExcalidrawElementSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  const fallback = ExcalidrawElementSchema.safeParse({ type, id: createElementId() });
  if (fallback.success) return fallback.data;
  throw new Error(`newElement: unsupported element type "${type}"`);
}
