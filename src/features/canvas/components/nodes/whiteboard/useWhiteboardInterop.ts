import { createSignal } from "solid-js";

import type { ExcalidrawFiles, ExcalidrawScene } from "./excalidrawTypes";
import type { ExcalidrawElement } from "./excalidrawTypes";
import { mergeImport, parseImportPayload, type ImportParse } from "./interop";
import { syncBoundTextOrigins } from "./boundText";

/**
 * File + clipboard interop state. The board stores a native Excalidraw v2
 * scene, so import merges parsed scenes directly (id-collision remap, fresh
 * `versionNonce`s) and export serializes the live scene. Image `files` are
 * session-local: they ride along on export but are not persisted to dataJson.
 */
export interface WhiteboardInteropDeps {
  elements: () => ExcalidrawElement[];
  commit: (next: ExcalidrawElement[]) => void;
  setSelectedIds: (ids: string[]) => void;
  viewBackgroundColor: () => string;
  setViewBackgroundColor: (v: string) => void;
  gridSize: () => number | null;
  setGridSize: (v: number | null) => void;
  sceneFiles: () => ExcalidrawFiles;
  setSceneFiles: (files: ExcalidrawFiles) => void;
}

export function useWhiteboardInterop(deps: WhiteboardInteropDeps) {
  const [interopFiles, setInteropFiles] = createSignal<ExcalidrawFiles>({});
  const [interopNotice, setInteropNotice] = createSignal<string | null>(null);

  /** Current board as a native v2 scene (export path to excalidraw.com). */
  const nativeScene = (): ExcalidrawScene => ({
    type: "excalidraw",
    version: 2,
    source: "project-vault",
    elements: syncBoundTextOrigins(deps.elements()),
    appState: { viewBackgroundColor: deps.viewBackgroundColor(), gridSize: deps.gridSize() },
    files: { ...deps.sceneFiles(), ...interopFiles() },
  });

  const reportImport = (parsed: ImportParse, added: number) => {
    const parts: string[] = [];
    if (added > 0) parts.push(`Imported ${added} element${added === 1 ? "" : "s"}`);
    else parts.push("Nothing importable found");
    if (parsed.skippedTypes.length > 0) parts.push(`skipped: ${parsed.skippedTypes.join(", ")}`);
    if (parsed.filesSkipped > 0) {
      parts.push(
        parsed.filesOversize
          ? `${parsed.filesSkipped} image(s) over the 5 MB cap — downscale and re-import`
          : `${parsed.filesSkipped} image file(s) skipped`,
      );
    }
    setInteropNotice(parts.join(" · "));
    return { added, skippedTypes: parsed.skippedTypes };
  };

  /**
   * Import pasted/dropped/file text: full scene, bare `elements[]`, or
   * `excalidrawlib`. Elements append with id-collision remap; `image`/`frame`
   * and unknown types report as skipped. Selects the newcomers.
   */
  const importText = (text: string): { added: number; skippedTypes: string[] } => {
    const parsed = parseImportPayload(text);
    const base: ExcalidrawScene = {
      type: "excalidraw",
      version: 2,
      source: "project-vault",
      elements: deps.elements(),
      appState: {
        viewBackgroundColor: deps.viewBackgroundColor(),
        gridSize: deps.gridSize(),
      },
      files: deps.sceneFiles(),
    };
    const { scene, summary } = mergeImport(base, parsed);
    setInteropFiles((prev) => ({ ...prev, ...parsed.files }));
    const wasEmpty = deps.elements().length === 0;
    if (summary.addedIds.length > 0) {
      deps.commit(scene.elements);
      deps.setSelectedIds(summary.addedIds);
    }
    // Opening onto an empty board adopts the file's canvas settings.
    if (wasEmpty && (parsed.source === "scene" || parsed.source === "library")) {
      deps.setViewBackgroundColor(parsed.appState.viewBackgroundColor);
      deps.setGridSize(parsed.appState.gridSize);
    }
    return reportImport(parsed, summary.addedIds.length);
  };

  return { interopFiles, interopNotice, setInteropNotice, nativeScene, importText };
}

export type WhiteboardInterop = ReturnType<typeof useWhiteboardInterop>;
