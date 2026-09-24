import { describe, expect, it, vi } from "vitest";
import {
  emitWebPreviewEvent,
  encodeWebToolsTarget,
  linkedToolsId,
  parseWebToolsTarget,
  subscribeWebPreviewEvents,
} from "./webToolsBus";

describe("webToolsBus", () => {
  it("round-trips the target link through dataJson", () => {
    const json = encodeWebToolsTarget("node-web-preview");
    expect(parseWebToolsTarget(json)).toBe("node-web-preview");
  });

  it("returns null for missing or malformed dataJson", () => {
    expect(parseWebToolsTarget(null)).toBeNull();
    expect(parseWebToolsTarget(undefined)).toBeNull();
    expect(parseWebToolsTarget("not-json")).toBeNull();
    expect(parseWebToolsTarget(JSON.stringify({}))).toBeNull();
  });

  it("delivers events only to the linked target", () => {
    const a = vi.fn();
    const b = vi.fn();
    const unA = subscribeWebPreviewEvents("node-a", a);
    const unB = subscribeWebPreviewEvents("node-b", b);

    emitWebPreviewEvent({
      kind: "navigate",
      targetId: "node-a",
      atMs: 1,
      url: "http://localhost:3000",
    });

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();

    unA();
    unB();
  });

  it("unsubscribes cleanly", () => {
    const fn = vi.fn();
    const unsub = subscribeWebPreviewEvents("node-x", fn);
    unsub();
    emitWebPreviewEvent({ kind: "flush", targetId: "node-x", atMs: 2 });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("linkedToolsId (1:1 rule)", () => {
  const nodes = [
    { id: "web-1", nodeType: "webPreview", dataJson: null },
    { id: "tools-1", nodeType: "webTools", dataJson: JSON.stringify({ targetId: "web-1" }) },
    { id: "tools-2", nodeType: "webTools", dataJson: JSON.stringify({ targetId: "web-2" }) },
    { id: "tools-3", nodeType: "webTools", dataJson: "broken" },
    { id: "task-1", nodeType: "task", dataJson: JSON.stringify({ targetId: "web-1" }) },
  ];

  it("finds the single sibling linked to a preview", () => {
    expect(linkedToolsId(nodes, "web-1")).toBe("tools-1");
    expect(linkedToolsId(nodes, "web-2")).toBe("tools-2");
  });

  it("returns null when nothing claims the preview", () => {
    expect(linkedToolsId(nodes, "web-9")).toBeNull();
    expect(linkedToolsId([], "web-1")).toBeNull();
  });
});
