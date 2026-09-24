import type { CanvasNodeDto } from "~/types/dto";
import {
  DEFAULT_NODE_SIZE,
  resolveRenderGeometry,
  type MeasuredBox,
} from "../geometry/measuredSizes";

type ColumnRole = "source" | "runtime" | "pipeline" | "output";

function getColumnForNodeType(type: string): ColumnRole {
  switch (type) {
    case "git":
    case "notes":
    case "zettel":
      return "source";
    case "task":
    case "taskStep":
    case "terminal":
      return "runtime";
    case "github-actions":
      return "pipeline";
    case "dokploy":
    case "webPreview":
    case "webTools":
    case "filePreview":
    default:
      return "output";
  }
}

const COLUMN_X_MAP: Record<ColumnRole, number> = {
  source: 60,
  runtime: 420,
  pipeline: 800,
  output: 1180,
};

const DEFAULT_NODE_WIDTH = DEFAULT_NODE_SIZE.width;
const DEFAULT_NODE_HEIGHT = DEFAULT_NODE_SIZE.height;
const VERTICAL_GAP = 30;
const START_Y = 80;

export function calculateAutoLayout(
  nodes: CanvasNodeDto[],
  sizes: Record<string, MeasuredBox> = {},
): CanvasNodeDto[] {
  const columnTops: Record<ColumnRole, number> = {
    source: START_Y,
    runtime: START_Y,
    pipeline: START_Y,
    output: START_Y,
  };

  return nodes.map((node) => {
    const col = getColumnForNodeType(node.nodeType);
    const x = COLUMN_X_MAP[col];
    const y = columnTops[col];
    // Rendered box, not raw DTO: auto-height / minimized nodes stack by
    // their measured size so columns match what's on screen.
    const g = resolveRenderGeometry(node, sizes);
    const height = g.height || DEFAULT_NODE_HEIGHT;
    const width = g.width || DEFAULT_NODE_WIDTH;

    columnTops[col] += height + VERTICAL_GAP;

    return {
      ...node,
      x,
      y,
      width,
      height,
    };
  });
}
