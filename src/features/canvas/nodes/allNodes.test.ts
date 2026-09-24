import { describe, expect, it, vi } from "vitest";

// allNodes.ts pulls UI components (.tsx) which need a DOM; the test env is
// node, so stub the views — capability metadata is what we assert here.
vi.mock("../components/nodes/GitNode", () => ({ GitNode: () => null }));
vi.mock("../components/nodes/TaskNode", () => ({ TaskNode: () => null }));
vi.mock("../components/nodes/TaskStepNode", () => ({ TaskStepNode: () => null }));
vi.mock("../components/nodes/GithubActionsNode", () => ({ GithubActionsNode: () => null }));
vi.mock("../components/nodes/DokployNode", () => ({ DokployNode: () => null }));
vi.mock("../components/nodes/NotesNode", () => ({ NotesNode: () => null }));
vi.mock("../components/nodes/ZettelNode", () => ({
  ZettelNode: () => null,
  DEFAULT_ZETTEL: "# mock",
}));
vi.mock("../components/nodes/WhiteboardNode", () => ({ WhiteboardNode: () => null }));
vi.mock("../components/floating/FloatingTerminal", () => ({ FloatingTerminal: () => null }));
vi.mock("../components/floating/FloatingFilePreview", () => ({ FloatingFilePreview: () => null }));
vi.mock("../components/floating/FloatingWebPreview", () => ({ FloatingWebPreview: () => null }));
vi.mock("../components/floating/FloatingWebTools", () => ({ FloatingWebTools: () => null }));

import { getNodeDef } from "./registry";
import "./allNodes";

describe("built-in node capabilities", () => {
  it("whiteboard supports fullscreen (drawing board fills the canvas)", () => {
    expect(getNodeDef("whiteboard")?.capabilities?.allowFullscreen).toBe(true);
    expect(getNodeDef("whiteboard")?.capabilities?.resizable).toBe(true);
  });

  it("git supports fullscreen (diff view fills the canvas)", () => {
    expect(getNodeDef("git")?.capabilities?.allowFullscreen).toBe(true);
  });

  it("content-heavy preview nodes support fullscreen", () => {
    for (const type of [
      "notes",
      "zettel",
      "terminal",
      "filePreview",
      "webPreview",
      "webTools",
    ] as const) {
      expect(getNodeDef(type)?.capabilities?.allowFullscreen, type).toBe(true);
    }
  });

  it("small fixed-content cards stay non-fullscreen", () => {
    for (const type of ["task", "taskStep", "github-actions", "dokploy"] as const) {
      expect(getNodeDef(type)?.capabilities?.allowFullscreen ?? false, type).toBe(false);
    }
  });

  it("taskStep is a chainable single-task node with optional trigger", () => {
    const def = getNodeDef("taskStep");
    expect(def?.toolbar?.show).toBe(true);
    const trigger = def?.ports?.inputs.find((p) => p.id === "trigger");
    expect(trigger?.required ?? false).toBe(false);
    expect(def?.ports?.outputs.map((p) => p.id).sort()).toEqual(["done", "failed"]);
  });

  it("legacy task pool trigger is optional (unconnected = manual launcher)", () => {
    const trigger = getNodeDef("task")?.ports?.inputs.find((p) => p.id === "trigger");
    expect(trigger?.required ?? false).toBe(false);
  });
});
