import { describe, expect, it } from "vitest";

import { PROJECT_DETAIL_TABS, buildProjectUrl, buildSettingsUrl } from "./app-url";

describe("buildSettingsUrl", () => {
  it("keeps plugins and notifications tabs in the path", () => {
    expect(buildSettingsUrl("plugins")).toBe("/settings/plugins");
    expect(buildSettingsUrl("notifications")).toBe("/settings/notifications");
  });

  it("falls back to general for unknown tabs", () => {
    expect(buildSettingsUrl("not-a-tab")).toBe("/settings/general");
  });
});

describe("project detail tabs", () => {
  it("registers board next to issues (readme, canvas, issues, board, …)", () => {
    expect([...PROJECT_DETAIL_TABS]).toEqual([
      "readme",
      "canvas",
      "issues",
      "board",
      "files",
      "tasks",
      "terminal",
      "history",
    ]);
  });

  it("builds a canvas project URL (no readme fallback)", () => {
    expect(buildProjectUrl("abc", "canvas")).toBe("/projects/abc/canvas");
  });

  it("builds a board project URL (no readme fallback)", () => {
    expect(buildProjectUrl("abc", "board")).toBe("/projects/abc/board");
  });

  it("falls back to readme for unknown tabs", () => {
    expect(buildProjectUrl("abc", "not-a-tab")).toBe("/projects/abc/readme");
  });
});
