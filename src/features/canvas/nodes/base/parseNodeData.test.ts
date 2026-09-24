import { describe, it, expect } from "vitest";
import { parseNodeData, encodeNodeData } from "./parseNodeData";

describe("parseNodeData", () => {
  it("returns fallback for missing/malformed input", () => {
    expect(parseNodeData(null, { a: 1 })).toEqual({ a: 1 });
    expect(parseNodeData("not-json", { a: 1 })).toEqual({ a: 1 });
  });

  it("round-trips typed payloads", () => {
    const data = { targetId: "p1" };
    const json = encodeNodeData(data);
    expect(parseNodeData(json, null)).toEqual(data);
    expect(encodeNodeData(null)).toBeNull();
  });
});
