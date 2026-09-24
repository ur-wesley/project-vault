import { createEffect, onCleanup, onMount } from "solid-js";

import type { useEventHub } from "~/lib/event-hub-context";
import { watchProjectFiles } from "~/services/tauri/files";
import type { createFileTabsModel } from "./fileTabsModel";

type Hub = ReturnType<typeof useEventHub>;

/**
 * File watcher + editor-shortcut domain. (Extracted verbatim from FileTree.)
 */
export function createFileWatcherModel(opts: {
  model: ReturnType<typeof createFileTabsModel>;
  hub: Hub;
}) {
  const { model, hub } = opts;

  // Keep the backend watcher pointed at the currently open files.
  createEffect(() => {
    const paths = model.watcherPaths();
    void watchProjectFiles(paths);
  });

  // Registry-dispatched file actions (rebindable in Settings). This tree is
  // mounted exactly while the Files tab is active, which is the scope gate.
  // Find/goto/format need the editor apis and are handled in FileEditorTabs.
  onMount(() => {
    const unsubShortcuts = hub.on("shortcut:action", ({ action }) => {
      const path = model.activeTab()?.path;
      if (action === "file:save" && path) void model.save(path);
      else if (action === "file:save-all") void model.saveAll();
      else if (action === "file:close-tab" && path) model.requestClose(path);
    });
    onCleanup(() => {
      unsubShortcuts();
    });
  });
}
