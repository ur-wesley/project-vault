import type { CanvasWireDto, CanvasWireStatus, CanvasWireType } from "~/types/dto";

export type ConnectRejectReason = "self" | "duplicate";

export type ConnectVerdict = { ok: true } | { ok: false; reason: ConnectRejectReason };

/**
 * User-connection rules: no self-connections, no duplicate pairs.
 * Duplicates are undirected — a wire A->B blocks B->A too, since the
 * canvas renders connections without directionality.
 */
export function canConnectManual(
  sourceId: string,
  targetId: string,
  wires: readonly CanvasWireDto[],
): ConnectVerdict {
  if (!sourceId || !targetId) return { ok: false, reason: "self" };
  if (sourceId === targetId) return { ok: false, reason: "self" };
  const dup = wires.some(
    (w) =>
      (w.sourceId === sourceId && w.targetId === targetId) ||
      (w.sourceId === targetId && w.targetId === sourceId),
  );
  if (dup) return { ok: false, reason: "duplicate" };
  return { ok: true };
}

export const WIRE_TYPE_OPTIONS: CanvasWireType[] = [
  "sync",
  "stream",
  "pipeline",
  "execution",
  "deployment",
];

export const WIRE_STATUS_OPTIONS: CanvasWireStatus[] = ["nominal", "amber", "red"];

export function createManualWireId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `wire-${crypto.randomUUID()}`;
    }
  } catch {
    // fall through to timestamp fallback
  }
  return `wire-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

const MAX_ANNOTATION = 80;

export type WirePatch = Pick<CanvasWireDto, "annotation" | "status" | "wireType">;

/**
 * Whitelist + normalize user edits. Unknown enum values are dropped;
 * blank annotations become null (hides the badge).
 */
export function sanitizeWirePatch(patch: Partial<WirePatch>): Partial<WirePatch> {
  const out: Partial<WirePatch> = {};
  if (patch.annotation !== undefined) {
    const text = patch.annotation?.trim().slice(0, MAX_ANNOTATION) ?? "";
    out.annotation = text.length > 0 ? text : null;
  }
  if (patch.status != null) {
    if ((WIRE_STATUS_OPTIONS as readonly string[]).includes(patch.status)) {
      out.status = patch.status;
    }
  }
  if (patch.wireType != null) {
    if ((WIRE_TYPE_OPTIONS as readonly string[]).includes(patch.wireType)) {
      out.wireType = patch.wireType;
    }
  }
  return out;
}
