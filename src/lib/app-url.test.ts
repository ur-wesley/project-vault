import { describe, expect, it } from "vitest";

import { buildSettingsUrl } from "./app-url";

describe("buildSettingsUrl", () => {
  it("keeps plugins and notifications tabs in the path", () => {
    expect(buildSettingsUrl("plugins")).toBe("/settings/plugins");
    expect(buildSettingsUrl("notifications")).toBe("/settings/notifications");
  });

  it("falls back to general for unknown tabs", () => {
    expect(buildSettingsUrl("not-a-tab")).toBe("/settings/general");
  });
});
