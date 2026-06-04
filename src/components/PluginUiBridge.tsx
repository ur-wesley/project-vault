import { createEffect, createMemo, createSignal, onCleanup, onMount, Show, For } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { upsertFooterSegment, removeFooterSegment, clearPluginFooterSegments, type PluginFooterColor } from "~/lib/plugin-footer";
import {
  upsertHeaderWidget,
  removeHeaderWidget,
  clearPluginHeaderWidgets,
  clearAllHeaderWidgets,
  type PluginHeaderWidget,
} from "~/lib/plugin-header-widgets";
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
import { FilePreview } from "~/features/project-detail/components/FilePreview";
import { IssueMarkdown } from "~/features/project-detail/components/IssueMarkdown";

interface BridgeQuickPickItem {
  id: string;
  label: string;
  detail?: string;
  icon?: string;
  filePath?: string;
  lineNumber?: number;
}

interface BridgeQuickPickOptions {
  id: string;
  title: string;
  items: BridgeQuickPickItem[];
  fuzzy?: boolean;
  preview?: boolean;
}

interface FormField {
  id: string;
  label: string;
  fieldType: "text" | "number" | "boolean" | "select" | "textarea";
  placeholder?: string;
  defaultValue?: any;
  options?: { id: string; label: string }[];
  required?: boolean;
  pattern?: string;
  validationMessage?: string;
  min?: number;
  max?: number;
  step?: number;
}

export function PluginUiBridge(props: {
  projectId?: string | null;
  detailTab?: string | null;
  subDetail?: string | null;
}) {
  const { t } = useI18n();
  // ── Markdown dialog state ──────────────────────────────────────────────────
  const [markdownDialog, setMarkdownDialog] = createSignal<{ pluginId: string; title: string; content: string } | null>(null);

  // ── Input box state ────────────────────────────────────────────────────────
  const [inputBox, setInputBox] = createSignal<{ id: string; title: string; placeholder?: string } | null>(null);
  const [inputValue, setInputValue] = createSignal("");

  // ── Quick pick state ───────────────────────────────────────────────────────
  const [quickPick, setQuickPick] = createSignal<BridgeQuickPickOptions | null>(null);
  const [qpSearch, setQpSearch] = createSignal("");
  const [qpSelectedIdx, setQpSelectedIdx] = createSignal(0);
  let qpListRef: HTMLDivElement | undefined;

  // ── Dynamic Form state ─────────────────────────────────────────────────────
  const [formDialog, setFormDialog] = createSignal<{
    id: string;
    title: string;
    fields: FormField[];
  } | null>(null);
  const [formValues, setFormValues] = createSignal<Record<string, any>>({});
  const [formErrors, setFormErrors] = createSignal<Record<string, string>>({});

  // Reset search + selection when a new quick pick opens
  createEffect(() => {
    if (quickPick()) {
      setQpSearch("");
      setQpSelectedIdx(0);
    }
  });

  // Helper for fuzzy matching
  const fuzzyMatch = (str: string, query: string): number | null => {
    const strLen = str.length;
    const queryLen = query.length;
    if (queryLen === 0) return 0;
    if (queryLen > strLen) return null;

    let sIdx = 0;
    let qIdx = 0;
    let score = 0;
    let consecutive = 0;

    while (sIdx < strLen && qIdx < queryLen) {
      const sChar = str[sIdx].toLowerCase();
      const qChar = query[qIdx].toLowerCase();

      if (sChar === qChar) {
        let charScore = 1;
        if (consecutive > 0) {
          charScore += consecutive * 2;
        }
        if (sIdx === 0) {
          charScore += 5;
        } else {
          const prevChar = str[sIdx - 1];
          if (prevChar === "/" || prevChar === "\\" || prevChar === "_" || prevChar === "-" || prevChar === ".") {
            charScore += 5;
          }
        }
        score += charScore;
        consecutive++;
        qIdx++;
      } else {
        consecutive = 0;
      }
      sIdx++;
    }

    if (qIdx >= queryLen) {
      score -= strLen * 0.1;
      return score;
    }
    return null;
  };

  // Filtered items — case-insensitive substring or fuzzy match on label and detail
  const filteredQpItems = createMemo(() => {
    const items = quickPick()?.items ?? [];
    const q = qpSearch().toLowerCase().trim();
    if (!q) return items;

    if (quickPick()?.fuzzy) {
      const scored: { item: BridgeQuickPickItem; score: number }[] = [];
      for (const item of items) {
        const labelScore = fuzzyMatch(item.label, q);
        const detailScore = item.detail ? fuzzyMatch(item.detail, q) : null;
        
        if (labelScore !== null || detailScore !== null) {
          const score = Math.max(labelScore ?? -9999, detailScore ?? -9999);
          scored.push({ item, score });
        }
      }
      
      scored.sort((a, b) => b.score - a.score);
      return scored.map((x) => x.item);
    } else {
      return items.filter(
        (item) =>
          item.label.toLowerCase().includes(q) ||
          (item.detail?.toLowerCase().includes(q) ?? false),
      );
    }
  });

  const currentItem = createMemo(() => {
    const items = filteredQpItems();
    return items[qpSelectedIdx()] ?? null;
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

  onMount(() => {
    const unlistens: (() => void)[] = [];

    void (async () => {
      unlistens.push(await listen<[string, { title: string; placeholder?: string }]>("plugin:show-input", (event) => {
        const [id, options] = event.payload;
        setInputBox({ id, title: options.title, placeholder: options.placeholder });
        setInputValue("");
      }));

      unlistens.push(await listen<[string, { title: string; items: any[]; fuzzy?: boolean; preview?: boolean }]>("plugin:show-quick-pick", (event) => {
        const [id, options] = event.payload;
        setQuickPick({
          id,
          title: options.title,
          items: options.items,
          fuzzy: options.fuzzy,
          preview: options.preview,
        });
      }));

      unlistens.push(await listen<[string, { title: string; fields: FormField[] }]>("plugin:show-form", (event) => {
        const [id, options] = event.payload;
        const initialValues: Record<string, any> = {};
        for (const f of options.fields) {
          initialValues[f.id] = f.defaultValue !== undefined ? f.defaultValue : (f.fieldType === "boolean" ? false : "");
        }
        setFormValues(initialValues);
        setFormErrors({});
        setFormDialog({ id, title: options.title, fields: options.fields });
      }));

      unlistens.push(await listen<{ pluginId: string; css: string }>("plugin:inject-css", (event) => {
        const { pluginId, css } = event.payload;
        const styleId = `plugin-style-${pluginId}`;
        let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
        if (!styleEl) {
          styleEl = document.createElement("style");
          styleEl.id = styleId;
          document.head.appendChild(styleEl);
        }
        styleEl.textContent = css;
      }));

      unlistens.push(await listen<{ pluginId: string; enabled: boolean }>("plugin:status-changed", async (event) => {
        const { pluginId, enabled } = event.payload;
        if (enabled) {
          setEnabledPlugins((prev) => {
            if (prev.includes(pluginId)) return prev;
            return [...prev, pluginId];
          });
        } else {
          setEnabledPlugins((prev) => prev.filter((id) => id !== pluginId));
          const styleId = `plugin-style-${pluginId}`;
          document.getElementById(styleId)?.remove();
        }
      }));

    const unlistenSetFooter = await listen<{
      pluginId: string;
      id: string;
      text: string;
      icon?: string;
      tooltip?: string;
      command?: string;
      color: PluginFooterColor;
      position?: "left" | "right";
    }>("plugin:set-footer", (event) => {
      upsertFooterSegment(event.payload);
    });

    const unlistenClearFooter = await listen<{ pluginId: string; id: string }>("plugin:clear-footer", (event) => {
      removeFooterSegment(event.payload.pluginId, event.payload.id);
    });

    const unlistenMarkdown = await listen<{ pluginId: string; title: string; content: string }>("plugin:show-markdown-dialog", (event) => {
      setMarkdownDialog(event.payload);
    });

    const unlistenShowForm = await listen<[string, { title: string; fields: any[] }]>("plugin:show-form", (event) => {
      const [id, options] = event.payload;
      setFormDialog({ id, title: options.title, fields: options.fields });
      const defaults: Record<string, any> = {};
      for (const field of options.fields) {
        defaults[field.id] = field.defaultValue ?? "";
      }
      setFormValues(defaults);
    });

    // Run startup init for all enabled plugins
    try {
      const pluginsList = await invoke<{ id: string; enabled: boolean }[]>("list_plugins");
      setEnabledPlugins(pluginsList.filter((p) => p.enabled).map((p) => p.id));
    } catch (e) {
      console.error("Failed to run startup plugin initializations:", e);
    }

    // Register all event listeners
    unlistens.push(await listen<{ pluginId: string; id: string; text: string; icon?: string; tooltip?: string; command?: string; color: PluginFooterColor; position?: "left" | "right" }>("plugin:set-footer", (event) => {
      upsertFooterSegment(event.payload);
    }));

    unlistens.push(await listen<{ pluginId: string; id: string }>("plugin:clear-footer", (event) => {
      removeFooterSegment(event.payload.pluginId, event.payload.id);
    }));

    unlistens.push(await listen<{ pluginId: string; title: string; content: string }>("plugin:show-markdown-dialog", (event) => {
      setMarkdownDialog(event.payload);
    }));

    unlistens.push(await listen<{
      pluginId: string;
      id: string;
      type: "button" | "badge" | "text";
      text: string;
      icon?: string;
      tooltip?: string;
      command?: string;
      color: PluginFooterColor;
    }>("plugin:set-header-widget", (event) => {
      upsertHeaderWidget(event.payload);
    }));

    unlistens.push(await listen<{ pluginId: string; id: string }>("plugin:clear-header-widget", (event) => {
      removeHeaderWidget(event.payload.pluginId, event.payload.id);
    }));

    onCleanup(() => {
      for (const fn of unlistens) fn();
    });
  });

  let lastProjectId: string | null | undefined = undefined;
  let activeProjectIdAtLastTrigger: string | null | undefined = undefined;
  let pluginCommandTimeoutId: any = null;

  // Notify all enabled plugins when the active project or its view state changes
  createEffect(() => {
    const projectId = props.projectId ?? null;
    const detailTab = props.detailTab ?? null;
    const subDetail = props.subDetail ?? null;
    const plugins = enabledPlugins();

    onCleanup(() => {
      if (pluginCommandTimeoutId) {
        clearTimeout(pluginCommandTimeoutId);
      }
    });

    void (async () => {
      // 1. Immediately update backend active project (fast, no Luau VM)
      if (projectId !== lastProjectId) {
        lastProjectId = projectId;
        await invoke("set_active_project", { projectId }).catch(console.error);
        clearAllHeaderWidgets();
      }

      // 2. Debounce the heavy Luau plugin commands to avoid thread-spawning heap corruption
      pluginCommandTimeoutId = setTimeout(() => {
        if (plugins.length > 0) {
          const projectChanged = projectId !== activeProjectIdAtLastTrigger;
          activeProjectIdAtLastTrigger = projectId;

          for (const pluginId of plugins) {
            if (projectChanged) {
              invoke("execute_plugin_command", {
                pluginId,
                commandId: "project_focus",
                context: { projectId },
              }).catch(() => {});
            }

            invoke("execute_plugin_command", {
              pluginId,
              commandId: "project_state_changed",
              context: { projectId, detailTab, subDetail },
            }).catch(() => {});
          }
        }
      }, 150);
    })();
  });

  // Notify all enabled plugins when the active project workspace/view state changes
  createEffect(() => {
    const projectId = props.projectId ?? null;
    const detailTab = props.detailTab ?? null;
    const subDetail = props.subDetail ?? null;
    const plugins = enabledPlugins();
    if (plugins.length === 0) return;
    for (const pluginId of plugins) {
      invoke("execute_plugin_command", {
        pluginId,
        commandId: "project_state_changed",
        context: { projectId, detailTab, subDetail },
      }).catch(() => {
        // Silence: most plugins won't implement project_state_changed
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

  const validateForm = () => {
    const errors: Record<string, string> = {};
    const values = formValues();
    const dialog = formDialog();
    if (!dialog) return false;

    for (const field of dialog.fields) {
      const val = values[field.id];

      // Required check
      if (field.required) {
        if (val === undefined || val === null || val === "" || (field.fieldType === "boolean" && val === false)) {
          errors[field.id] = `${field.label} is required`;
          continue;
        }
      }

      // Pattern check (Regex)
      if (field.pattern && (field.fieldType === "text" || field.fieldType === "textarea")) {
        const strVal = String(val || "");
        if (strVal) {
          try {
            const rx = new RegExp(field.pattern);
            if (!rx.test(strVal)) {
              errors[field.id] = field.validationMessage || `${field.label} is invalid`;
              continue;
            }
          } catch {
            // ignore invalid regexes
          }
        }
      }

      // Number checks
      if (field.fieldType === "number" && val !== undefined && val !== null && val !== "") {
        const num = Number(val);
        if (Number.isNaN(num)) {
          errors[field.id] = "Must be a number";
          continue;
        }
        if (field.min !== undefined && num < field.min) {
          errors[field.id] = `Min value is ${field.min}`;
          continue;
        }
        if (field.max !== undefined && num > field.max) {
          errors[field.id] = `Max value is ${field.max}`;
          continue;
        }
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const resolveForm = async (submit: boolean) => {
    const current = formDialog();
    if (!current) return;
    if (submit) {
      if (!validateForm()) return; // Stop if invalid
      await invoke("resolve_plugin_ui", { id: current.id, value: formValues() });
    } else {
      await invoke("resolve_plugin_ui", { id: current.id, value: null });
    }
    setFormDialog(null);
    setFormErrors({});
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
        <DialogContent
          class={`gap-0 p-0 transition-all duration-200 overflow-hidden ${
            quickPick()?.preview
              ? "sm:max-w-[1100px] sm:h-[580px] flex flex-row"
              : "sm:max-w-[550px]"
          }`}
          hideCloseButton
          onKeyDown={handleQpKeyDown}
        >
          <div class={`flex flex-col ${quickPick()?.preview ? "w-[40%] min-w-[380px] border-r border-border/40 h-full" : "w-full"}`}>
            {/* Search bar */}
            <div class="flex items-center border-b px-3 shrink-0">
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
            <div
              ref={qpListRef}
              class={`overflow-y-auto p-1 ${
                quickPick()?.preview ? "flex-1" : "max-h-[320px]"
              }`}
            >
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

                <For each={filteredQpItems().slice(0, Math.max(100, qpSelectedIdx() + 20))}>
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
            <div class="flex items-center gap-3 border-t border-border/50 px-3 py-1.5 text-[10px] text-muted-foreground/70 shrink-0">
              <span><kbd class="font-mono">↑↓</kbd> {t("settings.pluginsUiNavHint")}</span>
              <span><kbd class="font-mono">Home</kbd>/<kbd class="font-mono">End</kbd> {t("settings.pluginsUiJumpHint")}</span>
              <span><kbd class="font-mono">Esc</kbd> {t("settings.pluginsUiCloseHint")}</span>
            </div>
          </div>

          <Show when={quickPick()?.preview}>
            <div class="flex-1 h-full min-w-0 bg-muted/5">
              <FilePreview
                path={currentItem()?.filePath ?? null}
                scrollToLine={currentItem()?.lineNumber}
              />
            </div>
          </Show>
        </DialogContent>
      </Dialog>
      {/* Dynamic Form Dialog */}
      <Dialog open={!!formDialog()} onOpenChange={(open) => !open && resolveForm(false)}>
        <DialogContent class="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{formDialog()?.title}</DialogTitle>
          </DialogHeader>
          <div class="py-4 space-y-4 max-h-[60vh] overflow-y-auto pr-2 scrollbar-thin">
            <For each={formDialog()?.fields}>
              {(field) => (
                <div class="flex flex-col gap-1.5">
                  <Show when={field.fieldType !== "boolean"}>
                    <label class="text-xs font-bold tracking-tight text-foreground/80">
                      {field.label}
                      <Show when={field.required}>
                        <span class="text-destructive ml-0.5">*</span>
                      </Show>
                    </label>
                  </Show>
                  
                  <Show when={field.fieldType === "text" || field.fieldType === "number"}>
                    <input
                      type={field.fieldType === "number" ? "number" : "text"}
                      placeholder={field.placeholder}
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      value={formValues()[field.id] ?? ""}
                      onInput={(e) => setFormValues((prev) => ({ 
                        ...prev, 
                        [field.id]: field.fieldType === "number" ? (e.currentTarget.value === "" ? "" : Number(e.currentTarget.value)) : e.currentTarget.value 
                      }))}
                      class={`flex h-9 w-full rounded-md border bg-background px-3 py-1.5 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary ${
                        formErrors()[field.id] ? "border-destructive focus-visible:ring-destructive" : "border-border/60"
                      }`}
                    />
                  </Show>

                  <Show when={field.fieldType === "textarea"}>
                    <textarea
                      placeholder={field.placeholder}
                      value={formValues()[field.id] ?? ""}
                      onInput={(e) => setFormValues((prev) => ({ ...prev, [field.id]: e.currentTarget.value }))}
                      class={`flex min-h-[80px] w-full rounded-md border bg-background px-3 py-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary ${
                        formErrors()[field.id] ? "border-destructive focus-visible:ring-destructive" : "border-border/60"
                      }`}
                    />
                  </Show>

                  <Show when={field.fieldType === "select"}>
                    <select
                      value={formValues()[field.id] ?? ""}
                      onChange={(e) => setFormValues((prev) => ({ ...prev, [field.id]: e.target.value }))}
                      class="flex h-9 w-full rounded-md border border-border/60 bg-background px-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                    >
                      <For each={field.options}>
                        {(opt) => (
                          <option value={opt.id} class="bg-background text-foreground text-xs">
                            {opt.label}
                          </option>
                        )}
                      </For>
                    </select>
                  </Show>

                  <Show when={field.fieldType === "boolean"}>
                    <label class="flex items-center gap-2 text-xs font-bold text-foreground/80 cursor-pointer py-1.5">
                      <input
                        type="checkbox"
                        checked={!!formValues()[field.id]}
                        onChange={(e) => setFormValues((prev) => ({ ...prev, [field.id]: e.target.checked }))}
                        class="rounded border border-border/60 bg-background text-primary focus:ring-primary size-4"
                      />
                      <span>{field.label}</span>
                      <Show when={field.required}>
                        <span class="text-destructive ml-0.5">*</span>
                      </Show>
                    </label>
                  </Show>

                  <Show when={formErrors()[field.id]}>
                    <span class="text-[10px] font-medium text-destructive">
                      {formErrors()[field.id]}
                    </span>
                  </Show>
                </div>
              )}
            </For>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => resolveForm(false)}>{t("common.cancel")}</Button>
            <Button onClick={() => resolveForm(true)}>{t("settings.pluginsUiOk")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Markdown Reader Dialog */}
      <Dialog open={!!markdownDialog()} onOpenChange={(open) => {
        if (!open) {
          const current = markdownDialog();
          if (current) {
            invoke("execute_plugin_command", {
              pluginId: current.pluginId,
              commandId: "markdown_dialog_closed",
              context: {},
            }).catch(() => {});
          }
          setMarkdownDialog(null);
        }
      }}>
        <DialogContent class="max-h-[85vh] overflow-y-auto overflow-x-hidden sm:max-w-[750px]">
          <DialogHeader>
            <DialogTitle>{markdownDialog()?.title}</DialogTitle>
          </DialogHeader>
          <div class="py-4">
            <Show when={markdownDialog()}>
              {(dialog) => (
                <div class="mx-auto w-full max-w-3xl prose prose-sm dark:prose-invert prose-headings:m-0 pv-markdown-dialog-content">
                  <IssueMarkdown content={dialog().content} />
                </div>
              )}
            </Show>
          </div>
          <DialogFooter>
            <Button onClick={() => setMarkdownDialog(null)}>{t("common.close") || "Close"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
  );
}
