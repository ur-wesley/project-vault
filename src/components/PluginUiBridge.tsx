import { createEffect, createMemo, createSignal, onCleanup, onMount, Show, For } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { upsertFooterSegment, removeFooterSegment, clearPluginFooterSegments, type PluginFooterColor } from "~/lib/plugin-footer";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { TextField, TextFieldInput, TextFieldLabel } from "~/components/ui/text-field";
import { useI18n } from "~/lib/i18n-context";

export function PluginUiBridge(props: { projectId?: string | null }) {
  const { t } = useI18n();
  // ── Input box state ────────────────────────────────────────────────────────
  const [inputBox, setInputBox] = createSignal<{ id: string; title: string; placeholder?: string } | null>(null);
  const [inputValue, setInputValue] = createSignal("");

  // ── Quick pick state ───────────────────────────────────────────────────────
  const [quickPick, setQuickPick] = createSignal<{
    id: string;
    title: string;
    items: { id: string; label: string; detail?: string; icon?: string }[];
  } | null>(null);
  const [qpSearch, setQpSearch] = createSignal("");
  const [qpSelectedIdx, setQpSelectedIdx] = createSignal(0);
  let qpListRef: HTMLDivElement | undefined;

  // Reset search + selection when a new quick pick opens
  createEffect(() => {
    if (quickPick()) {
      setQpSearch("");
      setQpSelectedIdx(0);
    }
  });

  // Filtered items — case-insensitive substring on label and detail
  const filteredQpItems = createMemo(() => {
    const items = quickPick()?.items ?? [];
    const q = qpSearch().toLowerCase().trim();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        (item.detail?.toLowerCase().includes(q) ?? false),
    );
  });

  // Clamp selected index when filter changes
  createEffect(() => {
    const max = filteredQpItems().length - 1;
    if (qpSelectedIdx() > max) setQpSelectedIdx(Math.max(0, max));
  });

  // Scroll the highlighted item into view whenever the selection moves
  createEffect(() => {
    const idx = qpSelectedIdx();
    if (!qpListRef) return;
    const items = qpListRef.querySelectorAll<HTMLElement>("[data-qp-item]");
    items[idx]?.scrollIntoView({ block: "nearest" });
  });

  // Keyboard handler for the quick pick dialog — full wrapping navigation
  const handleQpKeyDown = (e: KeyboardEvent) => {
    const items = filteredQpItems();
    if (items.length === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        // Wraps: last → first
        setQpSelectedIdx((i) => (i + 1) % items.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        // Wraps: first → last
        setQpSelectedIdx((i) => (i - 1 + items.length) % items.length);
        break;
      case "Home":
        e.preventDefault();
        setQpSelectedIdx(0);
        break;
      case "End":
        e.preventDefault();
        setQpSelectedIdx(items.length - 1);
        break;
      case "Enter": {
        e.preventDefault();
        const item = items[qpSelectedIdx()];
        if (item) resolveQuickPick(item.id);
        break;
      }
    }
  };

  // ── Plugin lifecycle ───────────────────────────────────────────────────────
  const [enabledPlugins, setEnabledPlugins] = createSignal<string[]>([]);

  onMount(async () => {
    const unlistenInput = await listen<[string, { title: string; placeholder?: string }]>("plugin:show-input", (event) => {
      const [id, options] = event.payload;
      setInputBox({ id, title: options.title, placeholder: options.placeholder });
      setInputValue("");
    });

    const unlistenQuickPick = await listen<[string, { title: string; items: any[] }]>("plugin:show-quick-pick", (event) => {
      const [id, options] = event.payload;
      setQuickPick({ id, title: options.title, items: options.items });
    });

    const unlistenInjectCss = await listen<{ pluginId: string; css: string }>("plugin:inject-css", (event) => {
      const { pluginId, css } = event.payload;
      const styleId = `plugin-style-${pluginId}`;
      let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
      if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = styleId;
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = css;
    });

    const unlistenStatusChanged = await listen<{ pluginId: string; enabled: boolean }>("plugin:status-changed", async (event) => {
      const { pluginId, enabled } = event.payload;
      if (enabled) {
        setEnabledPlugins((prev) => {
          if (prev.includes(pluginId)) return prev;
          return [...prev, pluginId];
        });
        try {
          await invoke("execute_plugin_command", {
            pluginId,
            commandId: "init",
            context: {},
          });
        } catch (initErr) {
          console.debug(`No custom init sequence for plugin: ${pluginId}`, initErr);
        }
      } else {
        setEnabledPlugins((prev) => prev.filter((id) => id !== pluginId));
        // Remove style tag
        const styleId = `plugin-style-${pluginId}`;
        document.getElementById(styleId)?.remove();
        // Clear all registered footer segments
        clearPluginFooterSegments(pluginId);
      }
    });

    const unlistenSetFooter = await listen<{
      pluginId: string;
      id: string;
      text: string;
      icon?: string;
      tooltip?: string;
      command?: string;
      color: PluginFooterColor;
    }>("plugin:set-footer", (event) => {
      upsertFooterSegment(event.payload);
    });

    const unlistenClearFooter = await listen<{ pluginId: string; id: string }>("plugin:clear-footer", (event) => {
      removeFooterSegment(event.payload.pluginId, event.payload.id);
    });

    // Run startup init for all enabled plugins
    try {
      const pluginsList = await invoke<{ id: string; enabled: boolean }[]>("list_plugins");
      setEnabledPlugins(pluginsList.filter((p) => p.enabled).map((p) => p.id));
      for (const p of pluginsList) {
        if (p.enabled) {
          try {
            await invoke("execute_plugin_command", {
              pluginId: p.id,
              commandId: "init",
              context: {},
            });
          } catch (initErr) {
            // Silence warnings for plugins without custom init routines
            console.debug(`No custom init sequence for plugin: ${p.id}`, initErr);
          }
        }
      }
    } catch (e) {
      console.error("Failed to run startup plugin initializations:", e);
    }

    onCleanup(() => {
      unlistenInput();
      unlistenQuickPick();
      unlistenInjectCss();
      unlistenStatusChanged();
      unlistenSetFooter();
      unlistenClearFooter();
    });
  });

  // Notify all enabled plugins when the active project changes
  createEffect(() => {
    const projectId = props.projectId ?? null;
    const plugins = enabledPlugins();
    if (plugins.length === 0) return;
    for (const pluginId of plugins) {
      invoke("execute_plugin_command", {
        pluginId,
        commandId: "project_focus",
        context: { projectId },
      }).catch(() => {
        // Silence: most plugins won't implement project_focus
      });
    }
  });

  // ── Resolve helpers ────────────────────────────────────────────────────────
  const resolveInput = async (value: string | null) => {
    const current = inputBox();
    if (!current) return;
    await invoke("resolve_plugin_ui", { id: current.id, value });
    setInputBox(null);
  };

  const resolveQuickPick = async (value: string | null) => {
    const current = quickPick();
    if (!current) return;
    await invoke("resolve_plugin_ui", { id: current.id, value });
    setQuickPick(null);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Input Box Dialog */}
      <Dialog open={!!inputBox()} onOpenChange={(open) => !open && resolveInput(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{inputBox()?.title}</DialogTitle>
          </DialogHeader>
          <div class="py-4">
            <TextField value={inputValue()} onChange={setInputValue}>
              <TextFieldLabel class="sr-only">{t("settings.pluginsUiInputLabel")}</TextFieldLabel>
              <TextFieldInput
                placeholder={inputBox()?.placeholder}
                onKeyDown={(e) => {
                  if (e.key === "Enter") resolveInput(inputValue());
                  if (e.key === "Escape") resolveInput(null);
                }}
                autofocus
              />
            </TextField>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => resolveInput(null)}>{t("common.cancel")}</Button>
            <Button onClick={() => resolveInput(inputValue())}>{t("settings.pluginsUiOk")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick Pick Dialog — custom implementation with full keyboard control */}
      <Dialog open={!!quickPick()} onOpenChange={(open) => !open && resolveQuickPick(null)}>
        <DialogContent class="gap-0 p-0 sm:max-w-[550px]" hideCloseButton onKeyDown={handleQpKeyDown}>
          {/* Search bar */}
          <div class="flex items-center border-b px-3">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="mr-2 size-4 shrink-0 opacity-50"
            >
              <path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" />
              <path d="M21 21l-6 -6" />
            </svg>
            <input
              class="flex h-11 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
              placeholder={quickPick()?.title ?? t("common.search")}
              value={qpSearch()}
              onInput={(e) => {
                setQpSearch(e.currentTarget.value);
                setQpSelectedIdx(0);
              }}
              autofocus
            />
            <span class="ml-2 shrink-0 rounded border border-border/60 bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              ↵ {t("settings.pluginsUiSelectHint")}
            </span>
          </div>

          {/* Item list */}
          <div ref={qpListRef} class="max-h-[320px] overflow-y-auto p-1">
            <Show
              when={filteredQpItems().length > 0}
              fallback={
                <div class="py-8 text-center text-sm text-muted-foreground">
                  {t("settings.pluginsUiNoResults")}
                </div>
              }
            >
              {/* Group heading */}
              <Show when={quickPick()?.title}>
                <div class="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  {quickPick()?.title}
                </div>
              </Show>

              <For each={filteredQpItems()}>
                {(item, idx) => (
                  <button
                    data-qp-item
                    type="button"
                    class={`flex w-full cursor-default select-none items-center gap-2 rounded-sm px-4 py-2 text-left text-sm outline-none transition-colors ${
                      idx() === qpSelectedIdx()
                        ? "bg-accent text-accent-foreground"
                        : "text-foreground hover:bg-accent/50"
                    }`}
                    onClick={() => resolveQuickPick(item.id)}
                    onPointerMove={() => setQpSelectedIdx(idx())}
                  >
                    <Show when={item.icon}>
                      <span class={`iconify ${item.icon} size-4 shrink-0 opacity-70`} />
                    </Show>
                    <div class="flex min-w-0 flex-col">
                      <span class="truncate font-medium">{item.label}</span>
                      <Show when={item.detail}>
                        <span class="truncate text-xs text-muted-foreground">{item.detail}</span>
                      </Show>
                    </div>
                    <Show when={idx() === qpSelectedIdx()}>
                      <span class="ml-auto shrink-0 text-xs text-muted-foreground opacity-60">↵</span>
                    </Show>
                  </button>
                )}
              </For>
            </Show>
          </div>

          {/* Footer hint bar */}
          <div class="flex items-center gap-3 border-t border-border/50 px-3 py-1.5 text-[10px] text-muted-foreground/70">
            <span><kbd class="font-mono">↑↓</kbd> {t("settings.pluginsUiNavHint")}</span>
            <span><kbd class="font-mono">Home</kbd>/<kbd class="font-mono">End</kbd> {t("settings.pluginsUiJumpHint")}</span>
            <span><kbd class="font-mono">Esc</kbd> {t("settings.pluginsUiCloseHint")}</span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
