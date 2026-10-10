import { Show, type Component } from "solid-js";

import type { WhiteboardStore } from "./whiteboard/useWhiteboardStore";
import {
  copyTextToClipboard,
  downloadScenePng,
  downloadTextFile,
  exportSceneJson,
  exportSceneSvg,
  readFileAsText,
} from "./whiteboard/interopExport";

/**
 * Phase 4 file row (whiteboard-excalidraw-parity step 20): `.excalidraw`
 * download, clipboard JSON, PNG/SVG export, and file-picker import. Paste +
 * file-drop handlers live on the board shell (`WhiteboardNode`); both funnel
 * through `store.importText`, and import reports land in `interopNotice`.
 */
export const WhiteboardFileRow: Component<{ store: WhiteboardStore }> = (props) => {
  const { store } = props;
  let fileInput: HTMLInputElement | undefined;

  const boardName = () => `whiteboard-${new Date().toISOString().slice(0, 10)}`;

  const handleExportFile = () => {
    try {
      const scene = store.nativeScene();
      downloadTextFile(`${boardName()}.excalidraw`, exportSceneJson(scene), "application/json");
      store.setInteropNotice(`Exported ${scene.elements.length} elements (.excalidraw opens on excalidraw.com)`);
    } catch {
      store.setInteropNotice("Export failed");
    }
  };

  const handleCopyJson = async () => {
    try {
      const scene = store.nativeScene();
      const ok = await copyTextToClipboard(exportSceneJson(scene));
      store.setInteropNotice(
        ok
          ? `Copied ${scene.elements.length} elements — paste on excalidraw.com`
          : "Copy failed — clipboard unavailable",
      );
    } catch {
      store.setInteropNotice("Copy failed — clipboard unavailable");
    }
  };

  const handleExportPng = () => {
    try {
      const scene = store.nativeScene();
      const ok = downloadScenePng(scene, `${boardName()}.png`);
      store.setInteropNotice(ok ? `Exported PNG (${scene.elements.length} elements)` : "PNG export failed");
    } catch {
      store.setInteropNotice("PNG export failed");
    }
  };

  const handleExportSvg = () => {
    try {
      const scene = store.nativeScene();
      downloadTextFile(`${boardName()}.svg`, exportSceneSvg(scene), "image/svg+xml");
      store.setInteropNotice(`Exported SVG (${scene.elements.length} elements)`);
    } catch {
      store.setInteropNotice("SVG export failed");
    }
  };

  const handlePickedFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      store.importText(await readFileAsText(file));
    } catch {
      store.setInteropNotice("Import failed — unreadable file");
    }
    if (fileInput) fileInput.value = "";
  };

  return (
    <div class="flex flex-wrap items-center gap-0.5 pb-2" onPointerDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        title="Download .excalidraw (opens on excalidraw.com)"
        aria-label="Export .excalidraw file"
        onClick={handleExportFile}
        class="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <span class="iconify mdi--download size-4" />
        .excalidraw
      </button>
      <button
        type="button"
        title="Copy board JSON (paste on excalidraw.com)"
        aria-label="Copy board JSON"
        onClick={() => void handleCopyJson()}
        class="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <span class="iconify mdi--content-copy size-4" />
        Copy JSON
      </button>
      <button
        type="button"
        title="Download PNG"
        aria-label="Export PNG"
        onClick={handleExportPng}
        class="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <span class="iconify mdi--image-outline size-4" />
        PNG
      </button>
      <button
        type="button"
        title="Download SVG"
        aria-label="Export SVG"
        onClick={handleExportSvg}
        class="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <span class="iconify mdi--vector-polyline size-4" />
        SVG
      </button>
      <button
        type="button"
        title="Import .excalidraw / .json / .excalidrawlib"
        aria-label="Import file"
        onClick={() => fileInput?.click()}
        class="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <span class="iconify mdi--upload size-4" />
        Import
      </button>
      <input
        ref={(el) => {
          fileInput = el;
        }}
        type="file"
        accept=".excalidraw,.json,.excalidrawlib,application/json"
        aria-label="Import whiteboard file"
        class="hidden"
        onChange={(e) => void handlePickedFile(e.currentTarget.files?.[0])}
      />
      <Show when={store.interopNotice() !== null}>
        <span class="ml-1 flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
          <span class="truncate">{store.interopNotice()}</span>
          <button
            type="button"
            title="Dismiss"
            aria-label="Dismiss import notice"
            onClick={() => store.setInteropNotice(null)}
            class="rounded px-1 transition-colors hover:bg-muted hover:text-foreground"
          >
            ✕
          </button>
        </span>
      </Show>
    </div>
  );
};
