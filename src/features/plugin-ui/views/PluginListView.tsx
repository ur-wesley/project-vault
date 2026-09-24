import { For, Show, type Component } from "solid-js";
import { PluginIcon } from "~/components/PluginIcon";
import { usePluginViewT } from "./pluginViewI18n";
import type { PluginListItem } from "../types";

const isNonActionItem = (itemId: string) => itemId.startsWith("section_") || itemId === "empty";

export const PluginListView: Component<{
  items: PluginListItem[];
  onRowClick?: (rowId: string) => void;
}> = (props) => {
  const t = usePluginViewT();
  return (
    <div class="flex min-h-0 flex-col">
      <Show
        when={(props.items.length ?? 0) > 0}
        fallback={
          <p class="px-2 py-8 text-center text-sm text-muted-foreground">
            {t("pluginView.noResults") as string}
          </p>
        }
      >
        <For each={props.items}>
          {(item) => (
            <Show
              when={!isNonActionItem(item.id)}
              fallback={
                <div class="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  {item.label}
                </div>
              }
            >
              <button
                type="button"
                class="flex w-full cursor-default select-none items-center gap-2 rounded-sm px-4 py-2 text-left text-sm text-foreground outline-none transition-colors hover:bg-accent/50"
                onClick={() => props.onRowClick?.(item.id)}
              >
                <PluginIcon icon={item.icon} class="size-4 shrink-0 opacity-70" />
                <div class="flex min-w-0 flex-col">
                  <span class="truncate font-medium">{item.label}</span>
                  <Show when={item.detail}>
                    <span class="truncate text-xs text-muted-foreground">{item.detail}</span>
                  </Show>
                </div>
              </button>
            </Show>
          )}
        </For>
      </Show>
    </div>
  );
};
