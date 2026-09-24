import { GitNode } from "../components/nodes/GitNode";
import { TaskNode } from "../components/nodes/TaskNode";
import { TaskStepNode } from "../components/nodes/TaskStepNode";
import { GithubActionsNode } from "../components/nodes/GithubActionsNode";
import { DokployNode } from "../components/nodes/DokployNode";
import { NotesNode } from "../components/nodes/NotesNode";
import { ZettelNode, DEFAULT_ZETTEL } from "../components/nodes/ZettelNode";
import { WhiteboardNode } from "../components/nodes/WhiteboardNode";
import { FloatingTerminal } from "../components/floating/FloatingTerminal";
import { FloatingFilePreview } from "../components/floating/FloatingFilePreview";
import { FloatingWebPreview } from "../components/floating/FloatingWebPreview";
import { FloatingWebTools } from "../components/floating/FloatingWebTools";
import { defineNode } from "./registry";

/**
 * Registry of all built-in canvas nodes. Adding a node = one defineNode()
 * call here (or in the node's own folder) — renderer, toolbar, icons,
 * and default sizes derive automatically.
 */
export function registerBuiltInNodes(): void {
  defineNode({
    type: "git",
    title: "Git Repository",
    icon: "mdi--git",
    defaultSize: { width: 280, height: 220 },
    capabilities: { resizable: true, allowFullscreen: true },
    toolbar: { show: true, order: 0 },
    component: GitNode as never,
  });
  defineNode({
    type: "task",
    title: "Task Runner",
    icon: "mdi--play-circle-outline",
    defaultSize: { width: 320, height: 240 },
    capabilities: { resizable: false },
    toolbar: { show: true, order: 5 },
    ports: {
      // Optional: an unconnected pool is a manual launcher, not an error.
      inputs: [{ id: "trigger", label: "Trigger", schema: "trigger" }],
      outputs: [
        { id: "done", label: "Done", schema: "task/result" },
        { id: "failed", label: "Failed", schema: "task/result" },
      ],
    },
    component: TaskNode as never,
  });
  defineNode({
    type: "taskStep",
    title: "Task Step",
    icon: "mdi--play-box-outline",
    defaultSize: { width: 320, height: 250 },
    defaultDataJson: JSON.stringify({ taskId: null, mode: "auto" }),
    capabilities: { resizable: false },
    toolbar: { show: true, order: 6 },
    ports: {
      // Optional trigger: unconnected steps are manual chain heads.
      inputs: [{ id: "trigger", label: "Trigger", schema: "trigger" }],
      outputs: [
        { id: "done", label: "Done", schema: "task/result" },
        { id: "failed", label: "Failed", schema: "task/result" },
      ],
    },
    component: TaskStepNode as never,
  });
  defineNode({
    type: "github-actions",
    title: "GitHub Actions",
    icon: "mdi--github",
    defaultSize: { width: 300, height: 260 },
    capabilities: { resizable: false },
    toolbar: { show: true, order: 7 },
    component: GithubActionsNode as never,
  });
  defineNode({
    type: "dokploy",
    title: "Dokploy",
    icon: "mdi--cloud-upload-outline",
    defaultSize: { width: 300, height: 220 },
    capabilities: { resizable: false },
    toolbar: { show: true, order: 8 },
    component: DokployNode as never,
  });
  defineNode({
    type: "notes",
    title: "Scratchpad Notes",
    icon: "mdi--notebook-outline",
    defaultSize: { width: 320, height: 220 },
    capabilities: { resizable: true, allowFullscreen: true },
    toolbar: { show: true, order: 10 },
    ports: {
      inputs: [
        {
          id: "text",
          label: "Text",
          schema: "text/plain",
          accepts: ["text/markdown", "task/result"],
        },
      ],
      outputs: [{ id: "text", label: "Text", schema: "text/plain" }],
    },
    component: NotesNode as never,
  });
  defineNode({
    type: "zettel",
    title: "Zettel",
    icon: "mdi--card-text-outline",
    defaultSize: { width: 340, height: 260 },
    defaultDataJson: DEFAULT_ZETTEL,
    capabilities: { resizable: true, allowFullscreen: true },
    toolbar: { show: true, order: 9 },
    ports: {
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
    component: ZettelNode as never,
  });
  defineNode({
    type: "whiteboard",
    title: "Whiteboard",
    icon: "mdi--draw",
    description: "Excalidraw-like sketch board: freehand, shapes, arrows, text.",
    defaultSize: { width: 560, height: 420 },
    capabilities: { resizable: true, allowFullscreen: true },
    toolbar: { show: true, order: 11 },
    component: WhiteboardNode as never,
  });
  defineNode({
    type: "terminal",
    title: "Floating Terminal",
    icon: "mdi--console",
    defaultSize: { width: 420, height: 300 },
    capabilities: { resizable: true, allowFullscreen: true },
    toolbar: { show: true, order: 1 },
    component: FloatingTerminal as never,
  });
  defineNode({
    type: "filePreview",
    title: "File Preview",
    icon: "mdi--file-code-outline",
    defaultSize: { width: 720, height: 480 },
    capabilities: { resizable: true, allowFullscreen: true },
    toolbar: { show: true, order: 2 },
    component: FloatingFilePreview as never,
  });
  defineNode({
    type: "webPreview",
    title: "Web Preview",
    icon: "mdi--web",
    defaultSize: { width: 420, height: 300 },
    capabilities: { resizable: true, allowFullscreen: true },
    toolbar: { show: true, order: 3 },
    component: FloatingWebPreview as never,
  });
  defineNode({
    type: "webTools",
    title: "Web DevTools",
    icon: "mdi--tools",
    defaultSize: { width: 420, height: 300 },
    capabilities: { resizable: true, allowFullscreen: true },
    toolbar: { show: true, order: 4 },
    component: FloatingWebTools as never,
  });
}

registerBuiltInNodes();
