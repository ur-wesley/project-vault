import { describe, it, expect } from "vitest";
import { linkedSiblingId, canClaimTarget, collectLinkedDeleteIds } from "./linking";
import type { CanvasNodeDto } from "~/types/dto";

const preview: CanvasNodeDto = { id: "p1", nodeType: "webPreview", title: "P", x: 0, y: 0 };
const tools: CanvasNodeDto = {
  id: "t1",
  nodeType: "webTools",
  title: "T",
  x: 0,
  y: 0,
  dataJson: JSON.stringify({ targetId: "p1" }),
};

describe("generic sibling linking", () => {
  it("finds the linked sibling", () => {
    expect(linkedSiblingId([preview, tools], "p1")).toBe("t1");
  });

  it("enforces the 1:1 claim rule", () => {
    expect(canClaimTarget([preview, tools], "t2", "p1")).toBe(false);
    expect(canClaimTarget([preview, tools], "t1", "p1")).toBe(true);
  });

  it("collects cascade deletes", () => {
    expect(collectLinkedDeleteIds([preview, tools], new Set(["p1"]))).toEqual(["t1"]);
  });
});
