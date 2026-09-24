import { createSignal } from "solid-js";
import type { Accessor, Setter } from "solid-js";

import { joinPathSync, parentDirOf } from "~/lib/path-utils";
import type { FileEntryRequest } from "../components/FileEntryDialog";
import type { FileEntryOp } from "../components/FileTreeContextMenu";
import type { createFileTabsModel } from "./fileTabsModel";

/**
 * File-entry operations domain: create/rename/delete with tree refresh and
 * selection remapping. (Extracted verbatim from FileTree.)
 */
export function createFileOpsModel(opts: {
  model: ReturnType<typeof createFileTabsModel>;
  setRefreshToken: Setter<number>;
  selectedPath: Accessor<string | null>;
  setSelectedPath: Setter<string | null>;
  previewPath: Accessor<string | null>;
  setPreviewPath: Setter<string | null>;
  onSubDetailChange?: (sub: string | null) => void;
}) {
  const {
    model,
    setRefreshToken,
    selectedPath,
    setSelectedPath,
    previewPath,
    setPreviewPath,
    onSubDetailChange,
  } = opts;
  const [entryRequest, setEntryRequest] = createSignal<FileEntryRequest | null>(null);

  const onEntryOp = (op: FileEntryOp) => setEntryRequest(op);

  const onEntryConfirm = async (request: FileEntryRequest, value: string) => {
    if (request.kind === "newFile") {
      const result = await model.createFile(request.dirPath, value);
      if (result.ok) {
        setRefreshToken((n) => n + 1);
        const created = joinPathSync(request.dirPath, value);
        setSelectedPath(created);
        setPreviewPath(created);
        onSubDetailChange?.(created);
      }
    } else if (request.kind === "newFolder") {
      const result = await model.createFolder(request.dirPath, value);
      if (result.ok) setRefreshToken((n) => n + 1);
    } else if (request.kind === "rename") {
      const to = joinPathSync(parentDirOf(request.path), value);
      const result = await model.renamePath(request.path, to);
      if (result.ok) {
        setRefreshToken((n) => n + 1);
        const remap = (p: string | null) =>
          p &&
          (p === request.path ||
            p.startsWith(`${request.path}/`) ||
            p.startsWith(`${request.path}\\`))
            ? to + p.slice(request.path.length)
            : p;
        setSelectedPath((p) => remap(p));
        setPreviewPath((p) => remap(p));
      }
    } else {
      const result = await model.deletePath(request.path);
      if (result.ok) {
        setRefreshToken((n) => n + 1);
        const isAffected = (p: string | null) =>
          !!p &&
          (p === request.path ||
            p.startsWith(`${request.path}/`) ||
            p.startsWith(`${request.path}\\`));
        if (isAffected(selectedPath())) setSelectedPath(null);
        if (isAffected(previewPath())) setPreviewPath(null);
      }
    }
    setEntryRequest(null);
  };

  return { entryRequest, setEntryRequest, onEntryOp, onEntryConfirm };
}
