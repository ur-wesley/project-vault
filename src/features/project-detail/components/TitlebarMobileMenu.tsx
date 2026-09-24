import { For, Show, type Component } from "solid-js";

import { cn } from "~/lib/utils";
import { toggleProjectPin } from "~/lib/project-pins";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Button } from "~/components/ui/button";
import type { TitlebarActionProps } from "./TitlebarDesktopActions";

/**
 * Mobile titlebar menu: dropdown mirror of the desktop action row.
 * (Extracted verbatim from ProjectDetailHeader — kept separate from the
 * desktop variant: class names and the incoming-list shape differ, and a
 * merged conditional version could not be visually verified.)
 */
export const TitlebarMobileMenu: Component<TitlebarActionProps> = (props) => {
  const { t, m, p, pinned, tabsEnabled } = props;

  return (
    <div class="flex items-stretch sm:hidden">
      <DropdownMenu
        gutter={0}
        onOpenChange={(open) => {
          if (open) m().fetchAndRefresh();
        }}
      >
        <DropdownMenuTrigger
          as={Button}
          variant="ghost"
          size="icon"
          class="h-full w-10 rounded-none px-0 text-muted-foreground/60 hover:bg-muted/80 hover:text-foreground focus-visible:ring-0"
        >
          <span class="iconify mdi--chevron-down size-5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent class="w-56">
          <Show when={m().gitStatusQ.data}>
            {(s) => (
              <div>
                <div class="mb-1 flex items-center justify-between border-b border-border/40 bg-muted/30 px-2 py-1.5">
                  <div class="flex min-w-0 items-center gap-2">
                    <span class="iconify mdi--git size-4 text-primary/80" />
                    <span class="max-w-[100px] truncate font-mono text-[10px] font-bold">
                      {s().branch}
                    </span>
                  </div>
                  <div class="flex items-center gap-1.5 shrink-0">
                    <span class="flex items-center gap-0.5 text-[10px] font-bold tabular-nums">
                      <span class="iconify mdi--arrow-up size-3 text-green-500" />
                      {s().ahead}
                    </span>
                    <span class="flex items-center gap-0.5 text-[10px] font-bold tabular-nums">
                      <span class="iconify mdi--arrow-down size-3 text-blue-500" />
                      {s().behind}
                    </span>
                  </div>
                </div>
                <Show when={s().hasUpstream}>
                  <DropdownMenuItem
                    disabled={m().isPushing() || m().isPulling()}
                    onClick={() => m().pushMutate()}
                  >
                    <Show
                      when={m().isPushing()}
                      fallback={<span class="iconify mdi--upload size-4" />}
                    >
                      <span class="iconify mdi--loading animate-spin size-4" />
                    </Show>
                    <span>{t("projectDetail.gitPushTooltip") as string}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={m().isPulling() || m().isPushing()}
                    onClick={() => m().pullMutate()}
                  >
                    <Show
                      when={m().isPulling()}
                      fallback={<span class="iconify mdi--download size-4" />}
                    >
                      <span class="iconify mdi--loading animate-spin size-4" />
                    </Show>
                    <span>{t("projectDetail.gitPullTooltip") as string}</span>
                  </DropdownMenuItem>
                  <Show when={s().behind > 0}>
                    <DropdownMenuItem
                      class="flex items-center justify-between"
                      onClick={() => props.setIncomingOpen(!props.incomingOpen())}
                    >
                      <span class="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                        {
                          t("projectDetail.gitIncomingTitle", {
                            count: s().behind,
                          }) as string
                        }
                      </span>
                      <span
                        class={`iconify mdi--chevron-down size-3 transition-transform ${props.incomingOpen() ? "rotate-180" : ""}`}
                      />
                    </DropdownMenuItem>
                    <Show when={props.incomingOpen()}>
                      <div class="max-h-32 space-y-1 overflow-y-auto px-2 py-1">
                        <Show
                          when={!m().gitIncomingQ.isFetching}
                          fallback={
                            <div class="flex items-center gap-2 py-1 text-[10px] text-muted-foreground">
                              <span class="iconify mdi--loading animate-spin size-3" />
                              {t("projectDetail.gitFetching") as string}
                            </div>
                          }
                        >
                          <For each={m().gitIncomingQ.data?.commits}>
                            {(commit) => (
                              <div class="flex flex-col gap-0.5 py-0.5">
                                <span class="truncate text-[10px] font-medium">
                                  {commit.message}
                                </span>
                                <span class="text-[9px] text-muted-foreground">
                                  {commit.author} · {commit.relativeTime}
                                </span>
                              </div>
                            )}
                          </For>
                        </Show>
                      </div>
                    </Show>
                  </Show>
                  <DropdownMenuItem
                    disabled={m().isTagging()}
                    onClick={() => props.setTagDialogOpen(true)}
                  >
                    <Show
                      when={m().isTagging()}
                      fallback={<span class="iconify mdi--tag-plus size-4" />}
                    >
                      <span class="iconify mdi--loading animate-spin size-4" />
                    </Show>
                    <span>{t("projectDetail.gitPushTag") as string}</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </Show>
              </div>
            )}
          </Show>
          <Show when={m().gitStatusQ.data == null && !m().gitStatusQ.isPending}>
            <DropdownMenuItem disabled={m().isIniting()} onClick={() => m().initMutate()}>
              <Show when={m().isIniting()} fallback={<span class="iconify mdi--git size-4" />}>
                <span class="iconify mdi--loading animate-spin size-4" />
              </Show>
              <span>{t("projectDetail.gitInit") as string}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </Show>
          <DropdownMenuItem
            onClick={() =>
              m().favMutate({
                id: p().id,
                favorite: !p().favorite,
              })
            }
          >
            <span
              class={cn(
                "iconify size-4",
                p().favorite ? "mdi--star text-yellow-500" : "mdi--star-outline",
              )}
            />
            <span>
              {p().favorite
                ? (t("projectDetail.gitUnstar") as string)
                : (t("projectDetail.gitStar") as string)}
            </span>
          </DropdownMenuItem>
          <Show when={tabsEnabled()}>
            <DropdownMenuItem onClick={() => toggleProjectPin(p().id)}>
              <span
                class={cn(
                  "iconify size-4",
                  pinned() ? "mdi--pin text-primary" : "mdi--pin-outline",
                )}
              />
              <span>
                {pinned()
                  ? (t("projectDetail.pinRemove") as string)
                  : (t("projectDetail.pinAdd") as string)}
              </span>
            </DropdownMenuItem>
          </Show>
          <DropdownMenuItem onClick={() => void m().onOpenProjectInFileManager(p().path)}>
            <span class="iconify mdi--folder-open size-4" />
            <span>{t("projectDetail.openInSystemExplorer") as string}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              m().setMoveTargetLocationId(null);
              m().setMoveOpen(true);
            }}
          >
            <span class="iconify mdi--file-move size-4" />
            <span>{t("projectDetail.moveProject") as string}</span>
          </DropdownMenuItem>
          <Show when={m().gitStatusQ.data}>
            <DropdownMenuItem onClick={() => props.setCleanDialogOpen(true)}>
              <span class="iconify mdi--broom size-4" />
              <span>{t("projectDetail.cleanProject") as string}</span>
            </DropdownMenuItem>
          </Show>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            class="text-destructive focus:bg-destructive/10 focus:text-destructive"
            onClick={() => props.setDeleteConfirmOpen(true)}
          >
            <span class="iconify mdi--trash-can-outline size-4" />
            <span>{t("projectDetail.deleteProject") as string}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
