import { createMemo, type Component, type JSX } from "solid-js";
import type { CanvasNodeDto, ProjectDto } from "~/types/dto";
import {
  CanvasNodeContainer,
  type CanvasNodeComponentProps,
} from "../../components/nodes/CanvasNodeContainer";
import { getNodeDef } from "../registry";
import { parseNodeData, encodeNodeData } from "./parseNodeData";
import type { NodeContext } from "../types";

export interface BaseNodeProps<TData = unknown> {
  node: CanvasNodeDto<TData>;
  project: () => ProjectDto;
  allNodes?: CanvasNodeDto[] | (() => CanvasNodeDto[]);
  isDraggable?: boolean;
  snapEnabled?: boolean;
  zoom?: number;
  resizable?: boolean;
  isFocused?: boolean;
  isFullscreen?: boolean;
  onToggleFullscreen?: CanvasNodeComponentProps["onToggleFullscreen"];
  badge?: string;
  badgeVariant?: "nominal" | "amber" | "red";
  children: JSX.Element | ((ctx: NodeContext<TData>) => JSX.Element);
  onPositionChange?: CanvasNodeComponentProps["onPositionChange"];
  onResize?: CanvasNodeComponentProps["onResize"];
  onDelete?: CanvasNodeComponentProps["onDelete"];
  onPinToggle?: CanvasNodeComponentProps["onPinToggle"];
  onStartDrag?: CanvasNodeComponentProps["onStartDrag"];
  onFocusNode?: CanvasNodeComponentProps["onFocusNode"];
  onDataChange?: CanvasNodeComponentProps["onDataChange"];
  onTitleChange?: CanvasNodeComponentProps["onTitleChange"];
}

/**
 * Nice base for all canvas nodes: resolves icon + resizable default from the
 * registry, builds a typed NodeContext (parsedData/updateData/setTitle/focus),
 * and forwards the 12 container callbacks in one spread.
 */
export const BaseNode: Component<BaseNodeProps<unknown>> = (props) => {
  const def = createMemo(() => getNodeDef(props.node.nodeType));
  const icon = () => def()?.icon ?? "mdi--application-outline";
  const resizable = () => props.resizable ?? def()?.capabilities?.resizable ?? true;

  const ctx: NodeContext<unknown> = {
    parsedData: () => parseNodeData<unknown>(props.node.dataJson, null),
    updateData: (data) => props.onDataChange?.(props.node.id, encodeNodeData(data)),
    updateDataJson: (json) => props.onDataChange?.(props.node.id, json),
    setTitle: (title) => props.onTitleChange?.(props.node.id, title),
    focus: () => props.onFocusNode?.(props.node.id),
  };

  const body = () =>
    typeof props.children === "function"
      ? (props.children as (c: NodeContext<unknown>) => JSX.Element)(ctx)
      : (props.children as JSX.Element);

  return (
    <CanvasNodeContainer
      node={props.node}
      icon={icon()}
      badge={props.badge}
      badgeVariant={props.badgeVariant}
      isDraggable={props.isDraggable}
      snapEnabled={props.snapEnabled}
      zoom={props.zoom}
      resizable={resizable()}
      isFocused={props.isFocused}
      isFullscreen={props.isFullscreen}
      onPositionChange={props.onPositionChange}
      onResize={props.onResize}
      onDelete={props.onDelete}
      onPinToggle={props.onPinToggle}
      onStartDrag={props.onStartDrag}
      onFocusNode={props.onFocusNode}
      onToggleFullscreen={props.onToggleFullscreen}
      onTitleChange={props.onTitleChange}
    >
      {body()}
    </CanvasNodeContainer>
  );
};
