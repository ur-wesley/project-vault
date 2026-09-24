import { describe, expect, it } from "vitest";
import type { CanvasNodeDto, CanvasWireDto } from "~/types/dto";
import { schemasCompatible, type NodePorts } from "./portSchemas";
import { canBindPorts, canConnectData, isDataWire, validatePipeline } from "./dataflow";

const PORTS: Record<string, NodePorts> = {
  task: {
    inputs: [{ id: "trigger", label: "Trigger", schema: "trigger", required: true }],
    outputs: [
      { id: "done", label: "Done", schema: "task/result" },
      { id: "failed", label: "Failed", schema: "task/result" },
    ],
  },
  zettel: {
    inputs: [
      {
        id: "markdown",
        label: "Markdown",
        schema: "text/markdown",
        accepts: ["text/plain", "task/result"],
      },
    ],
    outputs: [{ id: "markdown", label: "Markdown", schema: "text/markdown" }],
  },
  plain: {
    inputs: [{ id: "in", label: "In", schema: "text/plain" }],
    outputs: [{ id: "out", label: "Out", schema: "text/plain" }],
  },
};

const resolvePorts = (t: string) => PORTS[t] ?? null;

const node = (id: string, nodeType: string): CanvasNodeDto => ({
  id,
  nodeType,
  title: id,
  x: 0,
  y: 0,
});

const dataWire = (id: string, sourceId: string, targetId: string, extra = {}) => ({
  id,
  sourceId,
  targetId,
  kind: "data",
  sourcePort: "done",
  targetPort: "markdown",
  ...extra,
});

describe("schemasCompatible", () => {
  it("matches identical schemas", () => {
    expect(
      schemasCompatible(
        { id: "a", label: "a", schema: "task/result" },
        {
          id: "b",
          label: "b",
          schema: "task/result",
        },
      ),
    ).toBe(true);
  });

  it("treats json as universal", () => {
    const j = { id: "j", label: "j", schema: "json" };
    const t = { id: "t", label: "t", schema: "trigger" };
    expect(schemasCompatible(j, t)).toBe(true);
    expect(schemasCompatible(t, j)).toBe(true);
  });

  it("honors accepts lists", () => {
    expect(
      schemasCompatible(
        { id: "a", label: "a", schema: "task/result" },
        { id: "b", label: "b", schema: "text/markdown", accepts: ["task/result"] },
      ),
    ).toBe(true);
    expect(
      schemasCompatible(
        { id: "a", label: "a", schema: "git/status" },
        { id: "b", label: "b", schema: "text/markdown", accepts: ["task/result"] },
      ),
    ).toBe(false);
  });
});

describe("canConnectData", () => {
  const nodes = [node("task1", "task"), node("z1", "zettel")];

  it("allows task done -> zettel markdown", () => {
    expect(
      canConnectData(
        { nodeId: "task1", portId: "done" },
        { nodeId: "z1", portId: "markdown" },
        nodes,
        [],
        resolvePorts,
      ),
    ).toEqual({ ok: true });
  });

  it("rejects incompatible schemas", () => {
    const ns = [node("t1", "task"), node("p1", "plain")];
    expect(
      canConnectData(
        { nodeId: "t1", portId: "done" },
        { nodeId: "p1", portId: "in" },
        ns,
        [],
        resolvePorts,
      ),
    ).toEqual({ ok: false, reason: "schema" });
  });

  it("rejects unknown ports", () => {
    expect(
      canConnectData(
        { nodeId: "task1", portId: "nope" },
        { nodeId: "z1", portId: "markdown" },
        nodes,
        [],
        resolvePorts,
      ),
    ).toEqual({ ok: false, reason: "unknown-port" });
  });

  it("rejects a taken input port", () => {
    const wires = [dataWire("w1", "task1", "z1")] as CanvasWireDto[];
    const ns = [...nodes, node("task2", "task")];
    expect(
      canConnectData(
        { nodeId: "task2", portId: "done" },
        { nodeId: "z1", portId: "markdown" },
        ns,
        wires,
        resolvePorts,
      ),
    ).toEqual({ ok: false, reason: "port-taken" });
  });

  it("still rejects self and duplicates", () => {
    expect(
      canConnectData(
        { nodeId: "task1", portId: "done" },
        { nodeId: "task1", portId: "trigger" },
        nodes,
        [],
        resolvePorts,
      ).ok,
    ).toBe(false);
  });
});

describe("canBindPorts", () => {
  it("accepts compatible live bindings", () => {
    expect(canBindPorts("task", "done", "zettel", "markdown", resolvePorts)).toBe(true);
  });

  it("rejects missing or incompatible bindings", () => {
    expect(canBindPorts("task", "nope", "zettel", "markdown", resolvePorts)).toBe(false);
    expect(canBindPorts("task", "done", "plain", "in", resolvePorts)).toBe(false);
    expect(canBindPorts("plain", "out", "plain", "in", resolvePorts)).toBe(true);
  });
});

describe("isDataWire", () => {
  it("treats missing kind as visual", () => {
    expect(isDataWire({ kind: undefined })).toBe(false);
    expect(isDataWire({ kind: "assoc" })).toBe(false);
    expect(isDataWire({ kind: "data" })).toBe(true);
  });
});

describe("validatePipeline", () => {
  it("is clean for a valid task -> zettel edge", () => {
    const nodes = [node("task1", "task"), node("z1", "zettel")];
    const wires = [dataWire("w1", "task1", "z1")] as CanvasWireDto[];
    const issues = validatePipeline(nodes, wires, resolvePorts);
    // Only the task's own unfed trigger input remains — the edge is fine.
    expect(issues).toEqual([
      {
        code: "missing-input",
        message: `"task1" needs its "Trigger" input connected.`,
        nodeId: "task1",
      },
    ]);
  });

  it("ignores visual wires", () => {
    const nodes = [node("a", "task"), node("b", "task")];
    const wires = [{ id: "v", sourceId: "a", targetId: "b" }] as CanvasWireDto[];
    const issues = validatePipeline(nodes, wires, resolvePorts);
    expect(issues.filter((i) => i.code !== "missing-input")).toEqual([]);
  });

  it("reports missing required inputs", () => {
    const issues = validatePipeline([node("t1", "task")], [], resolvePorts);
    expect(issues.some((i) => i.code === "missing-input" && i.nodeId === "t1")).toBe(true);
  });

  it("reports cycles on the back-edge wire", () => {
    const nodes = [node("a", "zettel"), node("b", "zettel")];
    const wires = [
      {
        id: "w1",
        sourceId: "a",
        targetId: "b",
        kind: "data",
        sourcePort: "markdown",
        targetPort: "markdown",
      },
      {
        id: "w2",
        sourceId: "b",
        targetId: "a",
        kind: "data",
        sourcePort: "markdown",
        targetPort: "markdown",
      },
    ] as CanvasWireDto[];
    const issues = validatePipeline(nodes, wires, resolvePorts);
    expect(issues.some((i) => i.code === "cycle" && i.wireId === "w2")).toBe(true);
  });

  it("reports stale schema edges", () => {
    const nodes = [node("t1", "task"), node("p1", "plain")];
    const wires = [
      {
        id: "w1",
        sourceId: "t1",
        targetId: "p1",
        kind: "data",
        sourcePort: "done",
        targetPort: "in",
      },
    ] as CanvasWireDto[];
    const issues = validatePipeline(nodes, wires, resolvePorts);
    expect(issues.some((i) => i.code === "schema" && i.wireId === "w1")).toBe(true);
  });
});
