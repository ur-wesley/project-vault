import { describe, expect, it } from "vitest";
import type { CanvasWireDto } from "~/types/dto";
import { canConnectManual, sanitizeWirePatch } from "./manualWires";

const wire = (sourceId: string, targetId: string): CanvasWireDto => ({
  id: `wire-${sourceId}-${targetId}`,
  sourceId,
  targetId,
  wireType: "sync",
  status: "nominal",
});

describe("canConnectManual", () => {
  it("allows a fresh pair", () => {
    expect(canConnectManual("a", "b", [])).toEqual({ ok: true });
  });

  it("rejects self-connections", () => {
    expect(canConnectManual("a", "a", [])).toEqual({ ok: false, reason: "self" });
  });

  it("rejects exact duplicates", () => {
    expect(canConnectManual("a", "b", [wire("a", "b")])).toEqual({
      ok: false,
      reason: "duplicate",
    });
  });

  it("rejects reversed duplicates (undirected)", () => {
    expect(canConnectManual("b", "a", [wire("a", "b")])).toEqual({
      ok: false,
      reason: "duplicate",
    });
  });
});

describe("sanitizeWirePatch", () => {
  it("trims and caps annotation, blanks become null", () => {
    expect(sanitizeWirePatch({ annotation: "  hello  " })).toEqual({ annotation: "hello" });
    expect(sanitizeWirePatch({ annotation: "   " })).toEqual({ annotation: null });
    expect(sanitizeWirePatch({ annotation: "x".repeat(200) }).annotation).toHaveLength(80);
  });

  it("drops unknown status/type values", () => {
    expect(sanitizeWirePatch({ status: "nope" as never })).toEqual({});
    expect(sanitizeWirePatch({ wireType: "nope" as never })).toEqual({});
    expect(sanitizeWirePatch({ status: "amber", wireType: "stream" })).toEqual({
      status: "amber",
      wireType: "stream",
    });
  });
});
