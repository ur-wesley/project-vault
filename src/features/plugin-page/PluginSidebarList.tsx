import { For, Show, createMemo, onCleanup, onMount, type Component } from "solid-js";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Button } from "~/components/ui/button";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/ui/sidebar";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "~/components/ui/context-menu";
import { useI18n } from "~/lib/i18n-context";
import { isPluginPagePinned, setPluginPagePinned } from "~/lib/plugin-page-pins";
import { pluginPages } from "~/lib/plugin-pages";

export type PluginPageDeclaration = {
  id: string;
  title: string;
  icon?: string;
  defaultPinned: boolean;
  default_pinned?: boolean;
  command?: string;
};

export type PluginWithPages = {
  id: string;
  name: string;
  enabled: boolean;
  pages?: PluginPageDeclaration[];
};

function normalizeDefaultPinned(page: PluginPageDeclaration | undefined): boolean {
  if (!page) return false;
  return page.defaultPinned === true || page.default_pinned === true;
}

export const PluginSidebarList: Component<{
  activePluginId: string | null;
  activePageId: string | null;
  pinRevision: number;
  onOpenPage: (pluginId: string, pageId: string) => void;
  onPinChange?: () => void;
  onManagePlugins: () => void;
}> = (props) => {
  const { t } = useI18n();
  const qc = useQueryClient();

  const pluginsQ = createQuery(() => ({
    queryKey: ["plugins", "list"] as const,
    queryFn: async () => {
      if (!isTauri()) return [] as PluginWithPages[];
      const list = await invoke<PluginWithPages[]>("list_plugins");
      return list.map((plugin) => ({
        ...plugin,
        pages: (plugin.pages ?? []).map((page) => ({
          ...page,
          defaultPinned: normalizeDefaultPinned(page),
        })),
      }));
    },
    enabled: isTauri(),
  }));

  onMount(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen("plugin:reload", () => {
      void qc.invalidateQueries({ queryKey: ["plugins", "list"] });
    }).then((fn) => {
      unlisten = fn;
    });
    onCleanup(() => unlisten?.());
  });

  const pinnedEntries = createMemo(() => {
    void props.pinRevision;
    pluginPages();

    const byKey = new Map<
      string,
      { pluginId: string; pluginName: string; page: PluginPageDeclaration }
    >();

    for (const plugin of pluginsQ.data ?? []) {
      if (!plugin.enabled) continue;
      for (const page of plugin.pages ?? []) {
        const defaultPinned = normalizeDefaultPinned(page);
        if (!isPluginPagePinned(plugin.id, page.id, defaultPinned)) continue;
        const key = `${plugin.id}:${page.id}`;
        byKey.set(key, {
          pluginId: plugin.id,
          pluginName: plugin.name,
          page: { ...page, defaultPinned },
        });
      }
    }

    for (const live of pluginPages()) {
      const key = live.key;
      if (byKey.has(key)) continue;

      const plugin = (pluginsQ.data ?? []).find((p) => p.id === live.pluginId);
      if (plugin && !plugin.enabled) continue;

      if (!isPluginPagePinned(live.pluginId, live.id, true)) continue;

      const declared = plugin?.pages?.find((p) => p.id === live.id);
      byKey.set(key, {
        pluginId: live.pluginId,
        pluginName: plugin?.name ?? live.pluginId,
        page: {
          id: live.id,
          title: declared?.title ?? live.title ?? live.id,
          icon: declared?.icon,
          defaultPinned: declared ? normalizeDefaultPinned(declared) : true,
          command: declared?.command,
        },
      });
    }

    return Array.from(byKey.values());
  });

  const handleOpen = (pluginId: string, page: PluginPageDeclaration) => {
    props.onOpenPage(pluginId, page.id);
  };

  return (
    <SidebarGroup class="shrink-0 pl-2 pr-0 pt-0 pb-0">
      <SidebarGroupContent>
        <Show when={pinnedEntries().length > 0}>
          <SidebarMenu>
            <For each={pinnedEntries()}>
              {(entry) => (
                <SidebarMenuItem>
                  <ContextMenu>
                    <ContextMenuTrigger as="div" class="contents">
                      <SidebarMenuButton
                        size="sm"
                        isActive={
                          props.activePluginId === entry.pluginId &&
                          props.activePageId === entry.page.id
                        }
                        onClick={() => handleOpen(entry.pluginId, entry.page)}
                      >
                        <Show
                          when={entry.page.icon}
                          fallback={<span class="iconify mdi--puzzle-outline size-4 opacity-70" />}
                        >
                          <span class={`iconify ${entry.page.icon} size-4 opacity-70`} />
                        </Show>
                        <span class="truncate">{entry.page.title}</span>
                      </SidebarMenuButton>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem
                        onSelect={() => {
                          setPluginPagePinned(entry.pluginId, entry.page.id, false);
                          props.onPinChange?.();
                        }}
                      >
                        <span class="iconify mdi--pin-off-outline size-4" />
                        <span>{t("plugins.unpinPage") as string}</span>
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                </SidebarMenuItem>
              )}
            </For>
          </SidebarMenu>
        </Show>
        <Show when={pinnedEntries().length === 0}>
          <div class="flex flex-col items-center gap-2 px-2 py-4 text-center">
            <span class="iconify mdi--puzzle-outline size-6 opacity-50" />
            <p class="text-xs text-sidebar-foreground/60">{t("plugins.sidebarEmpty") as string}</p>
            <Button variant="outline" size="sm" onClick={() => props.onManagePlugins()}>
              {t("plugins.managePlugins") as string}
            </Button>
          </div>
        </Show>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};
