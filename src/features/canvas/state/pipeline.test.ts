import { describe, expect, it } from "vitest";
import type { CanvasNodeDto, CanvasWireDto, TaskDto } from "~/types/dto";
import {
  appendNoteLine,
  downstreamDataEdges,
  formatTaskResultLine,
  parseTaskStepData,
  planStepCompletion,
  resolveStepTask,
} from "./pipeline";

const task = (id: string, label = id): TaskDto => ({
  id,
  label,
  argv: ["bun", "run", label],
  kind: "test",
  cwd: null,
  depends: [],
});

const node = (id: string, nodeType: string, dataJson?: string | null): CanvasNodeDto => ({
  id,
  nodeType,
  title: id,
  x: 0,
  y: 0,
  dataJson: dataJson ?? null,
});

const stepData = (taskId: string | null, mode: "auto" | "manual" = "auto") =>
  JSON.stringify({ taskId, mode });

const dataWire = (
  id: string,
  sourceId: string,
  targetId: string,
  sourcePort: string,
  targetPort: string,
) =>
  ({
    id,
    sourceId,
    targetId,
    kind: "data",
    sourcePort,
    targetPort,
  }) as CanvasWireDto;

describe("parseTaskStepData", () => {
  it("falls back on missing/malformed payloads", () => {
    expect(parseTaskStepData(null)).toMatchObject({ taskId: null, mode: "auto" });
    expect(parseTaskStepData("not-json").taskId).toBeNull();
  });

  it("normalizes unknown modes to auto", () => {
    expect(parseTaskStepData(JSON.stringify({ taskId: "a", mode: "weird" })).mode).toBe("auto");
  });

  it("keeps run tracking fields", () => {
    const d = parseTaskStepData(
      JSON.stringify({ taskId: "a", mode: "manual", runSessionId: "s1", lastExit: 2 }),
    );
    expect(d).toMatchObject({ taskId: "a", mode: "manual", runSessionId: "s1", lastExit: 2 });
  });
});

describe("resolveStepTask", () => {
  const tasks = [task("build"), task("test")];

  it("matches by id", () => {
    expect(resolveStepTask(tasks, { taskId: "build", mode: "auto" })?.argv).toEqual([
      "bun",
      "run",
      "build",
    ]);
  });

  it("falls back to label", () => {
    expect(
      resolveStepTask([{ ...task("x"), label: "lint" }], { taskId: "lint", mode: "auto" })?.id,
    ).toBe("x");
  });

  it("returns null when unconfigured or unknown", () => {
    expect(resolveStepTask(tasks, { taskId: null, mode: "auto" })).toBeNull();
    expect(resolveStepTask(tasks, { taskId: "nope", mode: "auto" })).toBeNull();
  });
});

describe("downstreamDataEdges", () => {
  it("only follows matching data edges (visual exempt)", () => {
    const wires = [
      dataWire("w1", "a", "b", "done", "trigger"),
      dataWire("w2", "a", "c", "failed", "trigger"),
      { id: "v", sourceId: "a", targetId: "d" } as CanvasWireDto,
    ];
    expect(downstreamDataEdges("a", "done", wires).map((w) => w.id)).toEqual(["w1"]);
    expect(downstreamDataEdges("a", "failed", wires).map((w) => w.id)).toEqual(["w2"]);
  });
});

describe("planStepCompletion", () => {
  const tasks = [task("build"), task("test")];
  const source = node("s1", "taskStep", stepData("build"));

  it("fans done to an auto step and a note", () => {
    const nodes = [
      source,
      node("s2", "taskStep", stepData("test")),
      node("n1", "notes", "scratch"),
    ];
    const wires = [
      dataWire("w1", "s1", "s2", "done", "trigger"),
      dataWire("w2", "s1", "n1", "done", "text"),
    ];
    const actions = planStepCompletion({
      sourceNode: source,
      sourceLabel: "build",
      exitCode: 0,
      wires,
      nodes,
      tasks,
      atMs: 0,
    });
    expect(actions.map((a) => a.kind)).toEqual(["spawn-step", "append-note"]);
    expect(actions[0]?.task?.id).toBe("test");
    expect(actions[1]?.line).toContain("✓");
  });

  it("routes failed to the failed port only", () => {
    const nodes = [source, node("s2", "taskStep", stepData("test"))];
    const wires = [
      dataWire("w1", "s1", "s2", "done", "trigger"),
      dataWire("w2", "s1", "s2", "failed", "trigger"),
    ];
    const actions = planStepCompletion({
      sourceNode: source,
      sourceLabel: "build",
      exitCode: 1,
      wires,
      nodes,
      tasks,
      atMs: 0,
    });
    expect(actions.map((a) => a.wireId)).toEqual(["w2"]);
    expect(actions[0]?.line ?? "").toBe("");
  });

  it("skips manual steps (pause gate) and unconfigured steps", () => {
    const nodes = [
      source,
      node("m", "taskStep", stepData("test", "manual")),
      node("u", "taskStep", stepData(null)),
    ];
    const wires = [
      dataWire("w1", "s1", "m", "done", "trigger"),
      dataWire("w2", "s1", "u", "done", "trigger"),
    ];
    expect(
      planStepCompletion({
        sourceNode: source,
        sourceLabel: "build",
        exitCode: 0,
        wires,
        nodes,
        tasks,
        atMs: 0,
      }),
    ).toEqual([]);
  });

  it("ignores dangling targets", () => {
    const wires = [dataWire("w1", "s1", "ghost", "done", "trigger")];
    expect(
      planStepCompletion({
        sourceNode: source,
        sourceLabel: "build",
        exitCode: 0,
        wires,
        nodes: [source],
        tasks,
        atMs: 0,
      }),
    ).toEqual([]);
  });
});

describe("appendNoteLine", () => {
  it("appends with newline, keeps tail under cap", () => {
    expect(appendNoteLine("a", "b")).toBe("a\nb");
    expect(appendNoteLine(null, "b")).toBe("b");
    const big = appendNoteLine("x".repeat(9000), formatTaskResultLine("t", 0, 0));
    expect(big.length).toBeLessThanOrEqual(8000);
    expect(big).toContain("✓");
  });
});
