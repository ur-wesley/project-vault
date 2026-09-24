import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPinnedProjects,
  isProjectPinned,
  movePinnedProject,
  pinProject,
  prunePinnedProjects,
  setPinnedProjects,
  toggleProjectPin,
  unpinProject,
} from "./project-pins";

describe("project-pins", () => {
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
      clear: () => {
        store.clear();
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts empty", () => {
    expect(getPinnedProjects()).toEqual([]);
    expect(isProjectPinned("a")).toBe(false);
  });

  it("pins in order without duplicates", () => {
    pinProject("a");
    pinProject("b");
    pinProject("a");
    expect(getPinnedProjects()).toEqual(["a", "b"]);
  });

  it("unpins and toggles", () => {
    pinProject("a");
    pinProject("b");
    expect(toggleProjectPin("a")).toEqual(["b"]);
    expect(isProjectPinned("a")).toBe(false);
    expect(toggleProjectPin("a")).toEqual(["b", "a"]);
    expect(unpinProject("b")).toEqual(["a"]);
  });

  it("ignores empty ids", () => {
    pinProject("");
    toggleProjectPin("");
    expect(getPinnedProjects()).toEqual([]);
  });

  it("prunes pins for deleted projects", () => {
    setPinnedProjects(["a", "b", "c"]);
    expect(prunePinnedProjects(new Set(["a", "c"]))).toEqual(["a", "c"]);
    expect(getPinnedProjects()).toEqual(["a", "c"]);
  });

  it("setPinnedProjects dedups and drops empties", () => {
    expect(setPinnedProjects(["a", "", "b", "a"])).toEqual(["a", "b"]);
  });

  it("movePinnedProject reorders without mutating", () => {
    const ids = ["a", "b", "c", "d"];
    expect(movePinnedProject(ids, "a", "c")).toEqual(["b", "c", "a", "d"]);
    expect(movePinnedProject(ids, "d", "a")).toEqual(["d", "a", "b", "c"]);
    expect(movePinnedProject(ids, "b", "c")).toEqual(["a", "c", "b", "d"]);
    expect(ids).toEqual(["a", "b", "c", "d"]);
  });

  it("movePinnedProject ignores unknown or identical ids", () => {
    expect(movePinnedProject(["a", "b"], "x", "a")).toEqual(["a", "b"]);
    expect(movePinnedProject(["a", "b"], "a", "x")).toEqual(["a", "b"]);
    expect(movePinnedProject(["a", "b"], "a", "a")).toEqual(["a", "b"]);
  });
});
