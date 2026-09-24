import type { Component } from "solid-js";
import type { CanvasNodeType } from "~/types/dto";
import type { NodeDefinition, NodeMeta, NodeViewProps } from "./types";

const defs = new Map<string, NodeDefinition<unknown>>();

/**
 * Author a new canvas node in one call.
 *
 * ```tsx
 * export const MyNode = defineNode({
 *   type: "my-node", title: "My Node", icon: "mdi--star",
 *   defaultSize: { width: 320, height: 220 },
 *   component: MyNodeView,
 * });
 * ```
 * Registration is automatic — no edits to renderer, toolbar, or state needed.
 */
export function defineNode<TData = unknown>(
  meta: NodeMeta<TData> & { component: Component<NodeViewProps<TData>> },
): NodeDefinition<TData> {
  const def = { ...meta } as NodeDefinition<TData>;
  defs.set(meta.type, def as NodeDefinition<unknown>);
  return def;
}

export function getNodeDef<TData = unknown>(
  type: CanvasNodeType,
): NodeDefinition<TData> | undefined {
  return defs.get(type) as NodeDefinition<TData> | undefined;
}

export function listNodeDefs(): NodeDefinition<unknown>[] {
  return [...defs.values()].sort((a, b) => {
    const ao = a.toolbar?.order ?? 999;
    const bo = b.toolbar?.order ?? 999;
    return ao - bo;
  });
}

export function toolbarNodeDefs(): NodeDefinition<unknown>[] {
  return listNodeDefs().filter((d) => d.toolbar?.show !== false);
}

export function hasNodeDef(type: CanvasNodeType): boolean {
  return defs.has(type);
}

export function clearNodeRegistry(): void {
  defs.clear();
}
