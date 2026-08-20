import { describe, expect, it } from "vitest";

import { shouldSendOsNotification } from "./notification-os-gate";

const baseItem = {
  system: "auto" as const,
  systemSent: false,
};

const baseCtx = {
  quiet: false,
  systemEnabled: true,
  focused: false,
};

describe("shouldSendOsNotification", () => {
  it("blocks all OS notifications when quiet is on", () => {
    expect(
      shouldSendOsNotification({ ...baseItem, system: "auto" }, { ...baseCtx, quiet: true }),
    ).toBe(false);
    expect(
      shouldSendOsNotification({ ...baseItem, system: "always" }, { ...baseCtx, quiet: true }),
    ).toBe(false);
  });

  it("allows system always even when focused or OS disabled", () => {
    expect(
      shouldSendOsNotification(
        { ...baseItem, system: "always" },
        { ...baseCtx, focused: true, systemEnabled: false },
      ),
    ).toBe(true);
  });

  it("blocks auto when focused", () => {
    expect(
      shouldSendOsNotification({ ...baseItem, system: "auto" }, { ...baseCtx, focused: true }),
    ).toBe(false);
  });

  it("allows auto when unfocused and OS enabled", () => {
    expect(
      shouldSendOsNotification({ ...baseItem, system: "auto" }, { ...baseCtx, focused: false }),
    ).toBe(true);
  });

  it("blocks never regardless of other flags", () => {
    expect(
      shouldSendOsNotification({ ...baseItem, system: "never" }, baseCtx),
    ).toBe(false);
  });

  it("blocks when already sent", () => {
    expect(
      shouldSendOsNotification({ ...baseItem, systemSent: true }, baseCtx),
    ).toBe(false);
  });
});
