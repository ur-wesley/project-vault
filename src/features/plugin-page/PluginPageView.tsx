import { For, Show, createMemo, type Component } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "~/components/ui/button";
import { getPluginPage } from "~/lib/plugin-pages";
import { isPluginPagePinned, togglePluginPagePinned } from "~/lib/plugin-page-pins";
import { useI18n } from "~/lib/i18n-context";

export type PluginPageMeta = {
  pluginId: string;
  pageId: string;
  title: string;
  icon?: string;
  defaultPinned: boolean;
  command?: string;
};

export const PluginPageView: Component<{
  pluginId: string;
  pageId: string;
  meta: PluginPageMeta | undefined;
  pinRevision?: number;
  onPinChange?: () => void;
}> = (props) => {
  const { t } = useI18n();

  const content = createMemo(() => getPluginPage(props.pluginId, props.pageId));

  const displayTitle = createMemo(() => content()?.title ?? props.meta?.title ?? props.pageId);

  const pinned = createMemo(() => {
    void props.pinRevision;
    return isPluginPagePinned(props.pluginId, props.pageId, props.meta?.defaultPinned ?? false);
  });

  const isNonActionItem = (itemId: string) =>
    itemId.startsWith("section_") || itemId === "empty";

  const handleItemClick = async (itemId: string) => {
    const page = content();
    if (!page) return;
    if (isNonActionItem(itemId)) return;
    const cmd = page.itemCommand;
    if (!cmd) return;
    try {
      await invoke("execute_plugin_command", {
        pluginId: props.pluginId,
        commandId: cmd,
        context: { pageId: props.pageId, itemId },
      });
    } catch (e) {
      console.error("plugin page item click failed", e);
    }
  };

  const handleTogglePin = () => {
    togglePluginPagePinned(
      props.pluginId,
      props.pageId,
      props.meta?.defaultPinned ?? false,
    );
    props.onPinChange?.();
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div class="flex shrink-0 items-center gap-2 border-b border-border/50 px-4 py-3">
        <Show when={props.meta?.icon}>
          <span class={`iconify ${props.meta!.icon} size-5 shrink-0 opacity-70`} />
        </Show>
        <h1 class="min-w-0 flex-1 truncate text-sm font-semibold">{displayTitle()}</h1>
        <Button
          variant="ghost"
          size="icon"
          class="size-7 shrink-0"
          onClick={handleTogglePin}
          title={pinned() ? "Unpin from sidebar" : "Pin to sidebar"}
        >
          <span
            class={`iconify size-4 ${pinned() ? "mdi--pin text-primary" : "mdi--pin-outline opacity-60"}`}
          />
        </Button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto p-2">
        <Show
          when={(content()?.items.length ?? 0) > 0}
          fallback={
            <p class="px-2 py-8 text-center text-sm text-muted-foreground">
              {t("settings.pluginsUiNoResults") as string}
            </p>
          }
        >
          <For each={content()?.items ?? []}>
            {(item) => {
              const isSection = () =>
                isNonActionItem(item.id) || (!content()?.itemCommand && !item.id);
              return (
                <Show
                  when={!isSection()}
                  fallback={
                    <div class="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                      {item.label}
                    </div>
                  }
                >
                  <button
                    type="button"
                    class="flex w-full cursor-default select-none items-center gap-2 rounded-sm px-4 py-2 text-left text-sm outline-none transition-colors text-foreground hover:bg-accent/50"
                    onClick={() => void handleItemClick(item.id)}
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
                  </button>
                </Show>
              );
            }}
          </For>
        </Show>
      </div>
    </div>
  );
};
