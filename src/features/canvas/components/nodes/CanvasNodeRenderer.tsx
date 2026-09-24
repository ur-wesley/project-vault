import { Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { Component } from "solid-js";
import type { CanvasNodeComponentProps } from "./CanvasNodeContainer";
import { NotesNode } from "./NotesNode";
import { getNodeDef } from "../../nodes/registry";
import "../../nodes/allNodes";

/**
 * Registry-driven renderer: resolves the view from defineNode() metadata.
 * Unknown types fall back to NotesNode instead of a blank surface.
 */
export const CanvasNodeRenderer: Component<CanvasNodeComponentProps> = (props) => {
  const Def = () =>
    getNodeDef(props.node.nodeType)?.component as Component<CanvasNodeComponentProps> | undefined;
  return (
    <Show when={Def()} fallback={<NotesNode {...props} />}>
      {(C) => <Dynamic component={C()} {...props} />}
    </Show>
  );
};
