import { Show, type Component } from "solid-js";
import { useQueryClient } from "@tanstack/solid-query";
import { toast } from "solid-sonner";

import { stableErrorMessage } from "~/lib/invoke-error";
import { GITHUB_TOKEN_SETTING_KEY } from "~/services/github";
import { setSetting } from "~/services/tauri/settings";
import { openExternal } from "~/lib/open-external";
import { queryKeys } from "~/services/query-keys";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "~/components/ui/context-menu";
import type { useSidebarData, TFunction } from "./useSidebarData";

type GhViewerQuery = ReturnType<typeof useSidebarData>["ghViewerQ"];

/**
 * Sidebar footer GitHub account menu: avatar, profile link, logout.
 * (Extracted verbatim from App; openExternal now shared.)
 */
export const GitHubAuthMenu: Component<{
  t: TFunction;
  ghViewerQ: GhViewerQuery;
  onOpenSettingsTab: (tab: string) => void;
}> = (props) => {
  const { t, ghViewerQ } = props;
  const qc = useQueryClient();

  const onSignOut = async () => {
    const r = await setSetting(GITHUB_TOKEN_SETTING_KEY, "");
    if (r.isErr()) {
      toast.error(stableErrorMessage(t, r.error));
      return;
    }
    void qc.invalidateQueries({ queryKey: queryKeys.githubViewer() });
    void qc.invalidateQueries({
      predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "github",
    });
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger as="div" class="contents">
        <Tooltip>
          <TooltipTrigger
            as={Button}
            variant="ghost"
            class="h-8 flex-1 min-w-0 justify-start gap-2 px-1.5 text-left text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={() => {
              props.onOpenSettingsTab("accounts");
            }}
          >
            <Avatar class="size-6 shrink-0">
              <Show when={ghViewerQ.data != null && (ghViewerQ.data!.avatarUrl?.length ?? 0) > 0}>
                <AvatarImage
                  class="object-cover"
                  src={ghViewerQ.data!.avatarUrl ?? undefined}
                  alt={ghViewerQ.data?.login ?? ""}
                />
              </Show>
              <AvatarFallback class="bg-primary/20 text-xs font-medium text-primary">
                {ghViewerQ.isLoading
                  ? "…"
                  : (ghViewerQ.data?.login?.slice(0, 2).toUpperCase() ?? "?")}
              </AvatarFallback>
            </Avatar>
            <span class="min-w-0 flex-1 truncate text-left text-xs font-medium">
              {ghViewerQ.data != null ? ghViewerQ.data.login : (t("account.notSignedIn") as string)}
            </span>
          </TooltipTrigger>
          <TooltipContent>{t("settings.tabAccounts") as string}</TooltipContent>
        </Tooltip>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <Show when={ghViewerQ.data}>
          <ContextMenuItem
            onSelect={() => void openExternal(`https://github.com/${ghViewerQ.data!.login}`)}
          >
            <span class="iconify mdi--github size-4" />
            <span>View GitHub profile</span>
          </ContextMenuItem>
          <ContextMenuSeparator />
        </Show>
        <ContextMenuItem onSelect={() => void onSignOut()}>
          <span class="iconify mdi--logout size-4" />
          <span>Logout</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};
