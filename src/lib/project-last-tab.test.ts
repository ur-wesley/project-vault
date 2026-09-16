import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { lastTabFor, rememberTab } from "./project-last-tab";

const STORAGE_KEY = "pv-project-last-tab";

describe("project-last-tab", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns readme for missing project", () => {
    expect(lastTabFor("proj-a")).toBe("readme");
  });

  it("roundtrips a stored tab", () => {
    rememberTab("proj-a", "files");
    expect(lastTabFor("proj-a")).toBe("files");
  });

  it("keeps separate last tabs per project", () => {
    rememberTab("proj-a", "files");
    rememberTab("proj-b", "terminal");
    expect(lastTabFor("proj-a")).toBe("files");
    expect(lastTabFor("proj-b")).toBe("terminal");
  });

  it("falls back to readme for invalid stored tab", () => {
    store.set(STORAGE_KEY, JSON.stringify({ "proj-a": "not-a-tab" }));
    expect(lastTabFor("proj-a")).toBe("readme");
  });
});
