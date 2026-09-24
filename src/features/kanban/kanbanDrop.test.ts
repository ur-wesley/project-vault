import { describe, expect, it } from "vitest";

import { backendDropPosition, isNoOpDrop } from "./kanbanDrop";

describe("backendDropPosition", () => {
  it("maps 1:1 without filters", () => {
    expect(backendDropPosition(["x", "y"], ["x", "y"], "a", 0)).toBe(0);
    expect(backendDropPosition(["x", "a", "y"], ["x", "a", "y"], "a", 2)).toBe(2);
  });

  it("anchors on the visible successor when cards are filtered out", () => {
    // Full: [hidden, A, y]; visible: [A, y]; drop A after y.
    expect(backendDropPosition(["hidden", "a", "y"], ["a", "y"], "a", 1)).toBe(2);
    // Drop A before y.
    expect(backendDropPosition(["hidden", "a", "y"], ["a", "y"], "a", 0)).toBe(1);
  });

  it("appends past the end", () => {
    expect(backendDropPosition(["x"], ["x"], "a", 1)).toBe(1);
  });
});

describe("isNoOpDrop", () => {
  it("detects drops that change nothing", () => {
    // position counts in the order *without* the card: reinserting "a" at 1
    // rebuilds ["x","a","y"].
    expect(isNoOpDrop(["x", "a", "y"], "a", 1)).toBe(true);
    expect(isNoOpDrop(["x", "a", "y"], "a", 0)).toBe(false);
    expect(isNoOpDrop(["x", "a", "y"], "a", 2)).toBe(false);
  });

  it("cross-column drops are never no-ops", () => {
    expect(isNoOpDrop(["x", "y"], "a", 0)).toBe(false);
  });
});
