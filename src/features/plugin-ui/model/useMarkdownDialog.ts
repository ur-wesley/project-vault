import { createSignal, onCleanup, onMount } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

import type { MarkdownDialogState } from "./dialogTypes";

/**
 * Markdown-reader dialog domain: state, close dispatch, show-markdown
 * subscription. (Extracted verbatim from PluginUiBridge.)
 */
export function createMarkdownDialogModel() {
  const [markdownDialog, setMarkdownDialog] = createSignal<MarkdownDialogState | null>(null);

  const closeMarkdown = (reason: "dismiss" | "close-event" = "dismiss") => {
    const current = markdownDialog();
    if (reason === "close-event" && current) {
      invoke("execute_plugin_command", {
        pluginId: current.pluginId,
        commandId: "markdown_dialog_closed",
        context: {},
      }).catch(() => {});
    }
    setMarkdownDialog(null);
  };

  onMount(() => {
    const unlistens: (() => void)[] = [];
    void (async () => {
      unlistens.push(
        await listen<{ pluginId: string; title: string; content: string }>(
          "plugin:show-markdown-dialog",
          (event) => {
            setMarkdownDialog(event.payload);
          },
        ),
      );
    })();
    onCleanup(() => {
      for (const fn of unlistens) fn();
    });
  });

  return { markdownDialog, closeMarkdown };
}
