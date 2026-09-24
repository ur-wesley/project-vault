import type { Component } from "solid-js";
import type { CanvasNodeDto, CanvasNodeType, ProjectDto } from "~/types/dto";
import type { NodePorts } from "../state/portSchemas";

/** Props every canvas node view receives (stable, minimal, registry-driven). */
export interface NodeViewProps<TData = unknown> {
  node: CanvasNodeDto<TData>;
  project: () => ProjectDto;
  allNodes: () => CanvasNodeDto[];
  ctx: NodeContext<TData>;
}

/** Imperative helpers a node view uses instead of 12 drilled callbacks. */
export interface NodeContext<TData = unknown> {
  updateData: (data: TData | null) => void;
  updateDataJson: (json: string | null) => void;
  setTitle: (title: string) => void;
  focus: () => void;
  parsedData: () => TData | null;
}

export interface NodeCapabilities {
  resizable?: boolean;
  pinnable?: boolean;
  deletable?: boolean;
  /** Show the header fullscreen button (camera zoom so the node fills the canvas). */
  allowFullscreen?: boolean;
}

export interface NodeMeta<TData = unknown> {
  type: CanvasNodeType;
  /** Display title used when created from the toolbar. */
  title: string;
  /** Iconify class suffix, e.g. "mdi--git". */
  icon: string;
  description?: string;
  defaultSize: { width: number; height: number };
  defaultDataJson?: string | null;
  /**
   * Typed dataflow ports. Nodes without declarations can't participate in
   * functional connections — they keep visual (assoc) wires only.
   */
  ports?: NodePorts;
  capabilities?: NodeCapabilities;
  toolbar?: { show?: boolean; order?: number };
  __data?: TData;
}

export interface NodeDefinition<TData = unknown> extends NodeMeta<TData> {
  component: Component<NodeViewProps<TData>>;
}

/** Back-compat alias: existing nodes still import CanvasNodeComponentProps. */
export type { CanvasNodeComponentProps } from "../components/nodes/CanvasNodeContainer";
