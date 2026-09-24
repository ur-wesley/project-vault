import { For, Show, type Component } from "solid-js";

import { Dialog, DialogContent } from "~/components/ui/dialog";
import { FilePreview } from "~/features/project-detail/components/FilePreview";
import { PluginIcon } from "~/components/PluginIcon";
import type { TFunction } from "../model/dialogTypes";
import type { createQuickPickModel } from "../model/useQuickPick";

/**
 * Quick-pick dialog — custom implementation with full keyboard control
 * and optional file preview pane. Too bespoke for DialogShell; stays
 * hand-rolled. (Extracted verbatim from PluginUiBridge.)
 */
export const QuickPickDialog: Component<{
  t: TFunction;
  model: ReturnType<typeof createQuickPickModel>;
}> = (props) => {
  const { t, model } = props;

  return (
    <Dialog
      open={!!model.quickPick()}
      onOpenChange={(open) => !open && model.resolveQuickPick(null)}
    >
      <DialogContent
        class={`gap-0 p-0 transition-all duration-200 overflow-hidden ${
          model.quickPick()?.preview
            ? "sm:max-w-[1100px] sm:h-[580px] flex flex-row"
            : "sm:max-w-[550px]"
        }`}
        hideCloseButton
        onKeyDown={model.handleQpKeyDown}
      >
        <div
          class={`flex flex-col ${model.quickPick()?.preview ? "w-[40%] min-w-[380px] border-r border-border/40 h-full" : "w-full"}`}
        >
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
              placeholder={model.quickPick()?.title ?? t("common.search")}
              value={model.qpSearch()}
              onInput={(e) => {
                model.setQpSearch(e.currentTarget.value);
                model.setQpSelectedIdx(0);
              }}
              autofocus
            />
            <span class="ml-2 shrink-0 rounded border border-border/60 bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              ↵ {t("settings.pluginsUiSelectHint")}
            </span>
          </div>

          {/* Item list */}
          <div
            ref={model.setQpListRef}
            class={`overflow-y-auto p-1 ${model.quickPick()?.preview ? "flex-1" : "max-h-[320px]"}`}
          >
            <Show
              when={model.filteredQpItems().length > 0}
              fallback={
                <div class="py-8 text-center text-sm text-muted-foreground">
                  {t("settings.pluginsUiNoResults")}
                </div>
              }
            >
              {/* Group heading */}
              <Show when={model.quickPick()?.title}>
                <div class="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  {model.quickPick()?.title}
                </div>
              </Show>

              <For
                each={model.filteredQpItems().slice(0, Math.max(100, model.qpSelectedIdx() + 20))}
              >
                {(item, idx) => (
                  <button
                    data-qp-item
                    type="button"
                    class={`flex w-full cursor-default select-none items-center gap-2 rounded-sm px-4 py-2 text-left text-sm outline-none transition-colors ${
                      idx() === model.qpSelectedIdx()
                        ? "bg-accent text-accent-foreground"
                        : "text-foreground hover:bg-accent/50"
                    }`}
                    onClick={() => model.resolveQuickPick(item.id)}
                    onPointerMove={() => model.setQpSelectedIdx(idx())}
                  >
                    <PluginIcon icon={item.icon} class="size-4 shrink-0 opacity-70" />
                    <div class="flex min-w-0 flex-col">
                      <span class="truncate font-medium">{item.label}</span>
                      <Show when={item.detail}>
                        <span class="truncate text-xs text-muted-foreground">{item.detail}</span>
                      </Show>
                    </div>
                    <Show when={idx() === model.qpSelectedIdx()}>
                      <span class="ml-auto shrink-0 text-xs text-muted-foreground opacity-60">
                        ↵
                      </span>
                    </Show>
                  </button>
                )}
              </For>
            </Show>
          </div>

          {/* Footer hint bar */}
          <div class="flex items-center gap-3 border-t border-border/50 px-3 py-1.5 text-[10px] text-muted-foreground/70 shrink-0">
            <span>
              <kbd class="font-mono">↑↓</kbd> {t("settings.pluginsUiNavHint")}
            </span>
            <span>
              <kbd class="font-mono">Home</kbd>/<kbd class="font-mono">End</kbd>{" "}
              {t("settings.pluginsUiJumpHint")}
            </span>
            <span>
              <kbd class="font-mono">Esc</kbd> {t("settings.pluginsUiCloseHint")}
            </span>
          </div>
        </div>

        <Show when={model.quickPick()?.preview}>
          <div class="flex-1 h-full min-w-0 bg-muted/5">
            <FilePreview
              path={model.currentItem()?.filePath ?? null}
              scrollToLine={model.currentItem()?.lineNumber}
            />
          </div>
        </Show>
      </DialogContent>
    </Dialog>
  );
};
