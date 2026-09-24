import { describe, expect, it } from "vitest";
import { FALLBACK_HEADER_H, PORT_BODY_PAD, PORT_ROW_H, layoutDataPorts } from "./portLayout";
import { resolveAnchoredGeometry } from "./wireGeometry";
import type { NodePorts } from "../state/portSchemas";

const PORTS: NodePorts = {
  inputs: [{ id: "markdown", label: "Markdown", schema: "text/markdown" }],
  outputs: [
    { id: "done", label: "Done", schema: "task/result" },
    { id: "failed", label: "Failed", schema: "task/result" },
  ],
};

describe("layoutDataPorts", () => {
  it("stacks inputs left and outputs right below the header", () => {
    const geom = { x: 100, y: 50, width: 320, height: 220 };
    const { inputs, outputs } = layoutDataPorts(geom, PORTS);
    expect(inputs).toHaveLength(1);
    expect(outputs).toHaveLength(2);
    expect(inputs[0].x).toBe(100);
    expect(outputs[0].x).toBe(420);
    expect(outputs[1].y).toBeGreaterThan(outputs[0].y);
    expect(inputs[0].y).toBeGreaterThan(50);
  });

  it("anchors rows to the measured header height plus body pad", () => {
    const geom = { x: 100, y: 50, width: 320, height: 220 };
    const { inputs, outputs } = layoutDataPorts(geom, PORTS);
    expect(inputs[0].y).toBe(50 + FALLBACK_HEADER_H + PORT_BODY_PAD);
    expect(outputs[1].y).toBe(outputs[0].y + PORT_ROW_H);
  });

  it("follows a custom measured header height", () => {
    const geom = { x: 0, y: 100, width: 320, height: 220 };
    const { inputs } = layoutDataPorts(geom, PORTS, 40);
    expect(inputs[0].y).toBe(100 + 40 + PORT_BODY_PAD);
  });
});

describe("resolveAnchoredGeometry", () => {
  it("builds a horizontal cubic between fixed ports without NaN", () => {
    const g = resolveAnchoredGeometry({
      x1: 420,
      y1: 100,
      nx1: 1,
      ny1: 0,
      x2: 600,
      y2: 100,
      nx2: -1,
      ny2: 0,
    });
    expect(g.pathD).toMatch(/^M 420,100 C/);
    expect(g.pathD).not.toMatch(/NaN/);
    expect(g.midX).toBeGreaterThan(420);
    expect(g.midX).toBeLessThan(600);
  });
});
