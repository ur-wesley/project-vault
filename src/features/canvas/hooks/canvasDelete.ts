import type { CanvasNodeDto } from "~/types/dto";
import { parseWebToolsTarget } from "../webview/webToolsBus";

/**
 * Pure helper: given all nodes and the ids being deleted, returns the ids of
 * `webTools` nodes linked (via `dataJson.targetId`) to a deleted node, so
 * they can be cascade-deleted instead of left orphaned.
 */
export function collectCascadeDeleteIds(
  nodes: readonly Pick<CanvasNodeDto, "id" | "nodeType" | "dataJson">[],
  deletedIds: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (n.nodeType !== "webTools" || deletedIds.has(n.id)) continue;
    const target = parseWebToolsTarget(n.dataJson);
    if (target !== null && deletedIds.has(target)) out.push(n.id);
  }
  return out;
}
