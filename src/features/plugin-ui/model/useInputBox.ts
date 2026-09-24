import { createSignal, onCleanup, onMount } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

import type { InputBoxState } from "./dialogTypes";

/**
 * Input-box dialog domain: state, resolve, show-input subscription.
 * (Extracted verbatim from PluginUiBridge.)
 */
export function createInputBoxModel() {
  const [inputBox, setInputBox] = createSignal<InputBoxState | null>(null);
  const [inputValue, setInputValue] = createSignal("");

  const resolveInput = async (value: string | null) => {
    const current = inputBox();
    if (!current) return;
    await invoke("resolve_plugin_ui", { id: current.id, value });
    setInputBox(null);
  };

  onMount(() => {
    const unlistens: (() => void)[] = [];
    void (async () => {
      unlistens.push(
        await listen<[string, { title: string; placeholder?: string }]>(
          "plugin:show-input",
          (event) => {
            const [id, options] = event.payload;
            setInputBox({ id, title: options.title, placeholder: options.placeholder });
            setInputValue("");
          },
        ),
      );
    })();
    onCleanup(() => {
      for (const fn of unlistens) fn();
    });
  });

  return { inputBox, inputValue, setInputValue, resolveInput };
}
