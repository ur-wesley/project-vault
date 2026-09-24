import { describe, expect, it } from "vitest";
import { parsePollIntervalMs, PluginStoreMirror } from "./pluginStore";

describe("parsePollIntervalMs", () => {
  it("passes through valid values", () => {
    expect(parsePollIntervalMs(1000)).toBe(1000);
    expect(parsePollIntervalMs(2500)).toBe(2500);
  });

  it("rounds fractional values", () => {
    expect(parsePollIntervalMs(1500.4)).toBe(1500);
    expect(parsePollIntervalMs(1500.5)).toBe(1501);
  });

  it("clamps to [500, 60000]", () => {
    expect(parsePollIntervalMs(100)).toBe(500);
    expect(parsePollIntervalMs(499)).toBe(500);
    expect(parsePollIntervalMs(60001)).toBe(60000);
    expect(parsePollIntervalMs(1e9)).toBe(60000);
  });

  it("falls back on missing/non-numeric input", () => {
    expect(parsePollIntervalMs(undefined)).toBe(1000);
    expect(parsePollIntervalMs(null)).toBe(1000);
    expect(parsePollIntervalMs("fast")).toBe(1000);
    expect(parsePollIntervalMs(Number.NaN)).toBe(1000);
    expect(parsePollIntervalMs(Number.POSITIVE_INFINITY)).toBe(1000);
  });

  it("coerces numeric strings", () => {
    expect(parsePollIntervalMs("2000")).toBe(2000);
  });

  it("honors custom bounds and fallback", () => {
    expect(parsePollIntervalMs(5, 60, 10, 600)).toBe(10);
    expect(parsePollIntervalMs(undefined, 60, 10, 600)).toBe(60);
  });
});

describe("PluginStoreMirror sysmon interval flow", () => {
  it("round-trips a sysmon interval event through get()", () => {
    const mirror = new PluginStoreMirror();
    mirror.applyEvent({
      pluginId: "sysmon",
      key: "refresh_interval_ms",
      value: 2000,
      version: 2,
    });
    expect(mirror.get("sysmon", "refresh_interval_ms")).toBe(2000);
    expect(parsePollIntervalMs(mirror.get("sysmon", "refresh_interval_ms"))).toBe(2000);
  });
});
