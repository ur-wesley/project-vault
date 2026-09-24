export type AppScope = "fullstack" | "server" | "spa" | "desktop" | "cli" | "library" | "monorepo";

export type ViewportDto = {
  panX: number;
  panY: number;
  zoom: number;
};

export type CanvasNodeType =
  | "git"
  | "task"
  | "taskStep"
  | "notes"
  | "zettel"
  | "whiteboard"
  | "terminal"
  | "filePreview"
  | "webPreview"
  | "webTools"
  | "github-actions"
  | "dokploy"
  | (string & {});

export type CanvasLayoutMode = "auto" | "freeform" | (string & {});

export type CanvasWireStatus = "nominal" | "amber" | "red" | (string & {});

export type CanvasWireType =
  | "sync"
  | "stream"
  | "pipeline"
  | "execution"
  | "deployment"
  | (string & {});

export type CanvasNodeDto<TData = unknown> = {
  id: string;
  nodeType: CanvasNodeType;
  title: string;
  x: number;
  y: number;
  width?: number | null;
  height?: number | null;
  isPinned?: boolean | null;
  dataJson?: string | null;
  /** Typed phantom — never serialized, only for defineNode<TData> inference. */
  __data?: TData;
};

export type CanvasWireKind = "assoc" | "data" | (string & {});

export type CanvasWireDto = {
  id: string;
  sourceId: string;
  targetId: string;
  wireType?: CanvasWireType | null;
  status?: CanvasWireStatus | null;
  annotation?: string | null;
  ruleId?: string | null;
  actionCommand?: string | null;
  actionLabel?: string | null;
  /** "assoc" = visual link, "data" = functional dataflow edge. Absent = "assoc". */
  kind?: CanvasWireKind | null;
  /** Named output port on the source node (data wires only). */
  sourcePort?: string | null;
  /** Named input port on the target node (data wires only). */
  targetPort?: string | null;
};

export type CanvasBlueprintDto = {
  id: string;
  name: string;
  description?: string | null;
  appScope: string;
  layoutJson: string;
  isBuiltin: boolean;
  createdAtMs: number;
};

export type CanvasProjectLayoutDto = {
  projectId: string;
  blueprintId?: string | null;
  layoutMode: CanvasLayoutMode;
  viewport: ViewportDto;
  nodes: CanvasNodeDto[];
  wires: CanvasWireDto[];
  updatedAtMs: number;
  /** Schema version for breaking layout changes (v2 = typed nodeTypes). */
  schemaVersion?: number | null;
};

