import { describe, it, expect, beforeEach } from "vitest";
import { defineNode, getNodeDef, toolbarNodeDefs, clearNodeRegistry } from "./registry";
import { Show } from "solid-js";

describe("node registry", () => {
  beforeEach(() => clearNodeRegistry());

  it("registers and resolves a node", () => {
    defineNode({
      type: "test-node",
      title: "Test",
      icon: "mdi--star",
      defaultSize: { width: 320, height: 220 },
      component: (() => null) as never,
    });
    expect(getNodeDef("test-node")?.title).toBe("Test");
  });

  it("returns undefined for unknown types (renderer falls back)", () => {
    expect(getNodeDef("nope")).toBeUndefined();
  });

  it("hides toolbar:false nodes from the toolbar", () => {
    defineNode({
      type: "a",
      title: "A",
      icon: "mdi--a",
      defaultSize: { width: 1, height: 1 },
      toolbar: { show: false },
      component: (() => null) as never,
    });
    defineNode({
      type: "b",
      title: "B",
      icon: "mdi--b",
      defaultSize: { width: 1, height: 1 },
      component: (() => null) as never,
    });
    expect(toolbarNodeDefs().map((d) => d.type)).toEqual(["b"]);
    void Show;
  });
});
