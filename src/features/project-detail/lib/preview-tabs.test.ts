import { describe, expect, it } from "vitest";

import { applyOpenPreview, applyPinTab, type PreviewTabState } from "./preview-tabs";

const clean = () => false;
const tab = (path: string, preview: boolean): PreviewTabState => ({
  path,
  name: path.split("/").pop() ?? path,
  preview,
});

describe("applyOpenPreview", () => {
  it("opens the first file as a preview tab", () => {
    const result = applyOpenPreview([], null, "/a.ts", "a.ts", clean);
    expect(result).toEqual({ tabs: [tab("/a.ts", true)], activeId: "/a.ts" });
  });

  it("activates an already-open file without changing its state", () => {
    const tabs = [tab("/a.ts", false), tab("/b.ts", true)];
    const result = applyOpenPreview(tabs, "/a.ts", "/b.ts", "b.ts", clean);
    expect(result.activeId).toBe("/b.ts");
    expect(result.tabs).toEqual(tabs);
  });

  it("replaces a clean preview tab in place", () => {
    const tabs = [tab("/a.ts", false), tab("/b.ts", true)];
    const result = applyOpenPreview(tabs, "/b.ts", "/c.ts", "c.ts", clean);
    expect(result.tabs).toEqual([tab("/a.ts", false), tab("/c.ts", true)]);
    expect(result.activeId).toBe("/c.ts");
  });

  it("keeps a dirty preview and inserts beside it", () => {
    const tabs = [tab("/a.ts", false), tab("/b.ts", true)];
    const result = applyOpenPreview(tabs, "/b.ts", "/c.ts", "c.ts", (p) => p === "/b.ts");
    expect(result.tabs).toEqual([tab("/a.ts", false), tab("/b.ts", true), tab("/c.ts", true)]);
    expect(result.activeId).toBe("/c.ts");
  });

  it("inserts after the active tab when no preview slot exists", () => {
    const tabs = [tab("/a.ts", false), tab("/b.ts", false)];
    const result = applyOpenPreview(tabs, "/a.ts", "/c.ts", "c.ts", clean);
    expect(result.tabs.map((t) => t.path)).toEqual(["/a.ts", "/c.ts", "/b.ts"]);
  });
});

describe("applyPinTab", () => {
  it("pins a preview tab", () => {
    expect(applyPinTab([tab("/a.ts", true)], "/a.ts")).toEqual([tab("/a.ts", false)]);
  });

  it("leaves pinned tabs untouched", () => {
    const tabs = [tab("/a.ts", false)];
    expect(applyPinTab(tabs, "/a.ts")).toEqual(tabs);
  });

  it("ignores unknown paths", () => {
    const tabs = [tab("/a.ts", true)];
    expect(applyPinTab(tabs, "/missing.ts")).toEqual(tabs);
  });
});
