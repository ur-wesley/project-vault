import type { TreeNodeInput } from "nanovis";
import { formatBytes } from "~/lib/format-bytes";
import type { DirSizeNode } from "~/services/tauri/projects";

export type DiskUsageMeta = {
  path: string;
  isDir: boolean;
  isSkip: boolean;
};

/**
 * Maps a backend `DirSizeNode` to a nanovis tree input.
 * Uses the absolute path as stable id, the entry name as label and
 * carries dir/skip flags in `meta` for color + tooltip decisions.
 */
export function dirSizeNodeToNanovisInput(node: DirSizeNode): TreeNodeInput<DiskUsageMeta> {
  return {
    id: node.path || node.name,
    text: node.name,
    subtext: formatBytes(node.sizeBytes),
    size: node.sizeBytes,
    sizeSelf: node.children.length === 0 ? node.sizeBytes : 0,
    meta: { path: node.path, isDir: node.isDir, isSkip: node.isSkip },
    children: node.children.map(dirSizeNodeToNanovisInput),
  } as TreeNodeInput<DiskUsageMeta>;
}
