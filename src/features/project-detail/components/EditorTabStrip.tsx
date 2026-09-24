import { For, Show } from "solid-js";

import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { FileIcon } from "~/components/FileIcon";
import { useI18n } from "~/lib/i18n-context";
import { cn } from "~/lib/utils";

import type { FileTabsModel } from "../model/fileTabsModel";

/**
 * Tab strip: tab list with dirty dots and italic preview titles, plus
 * save-all / close-all actions. Double-click pins a preview tab.
 */
export function EditorTabStrip(props: {
  model: FileTabsModel;
  activePath: string | null;
  onPin: (path: string) => void;
}) {
  const { t } = useI18n();

  return (
    <div class="flex shrink-0 items-stretch border-b border-border/40 bg-muted/20">
      <div class="flex min-w-0 flex-1 items-stretch overflow-x-auto scrollbar-none">
        <For
          each={props.model.state.tabs}
          fallback={
            <span class="px-3 py-2 text-[10px] italic text-muted-foreground">
              {t("projectDetail.noOpenFiles") as string}
            </span>
          }
        >
          {(tab) => {
            const isActive = () => tab.path === props.activePath;
            const dirty = () => props.model.isDirty(tab.path);
            const isPreview = () => tab.preview && !dirty();
            return (
              <div
                class={cn(
                  "group flex max-w-56 shrink-0 cursor-pointer items-center gap-1.5 border-r border-border/40 px-2.5 py-1.5 text-[11px] transition-colors",
                  isActive()
                    ? "bg-background text-foreground"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                )}
                onClick={() => props.model.setActive(tab.path)}
                onDblClick={() => props.onPin(tab.path)}
                onAuxClick={(event) => {
                  if (event.button === 1) props.model.requestClose(tab.path);
                }}
              >
                <FileIcon name={tab.name} class="size-3.5 shrink-0" />
                <span
                  class={cn("min-w-0 truncate", isPreview() && "italic")}
                  title={isPreview() ? (t("projectDetail.previewTabHint") as string) : undefined}
                >
                  {tab.name}
                </span>
                <Show when={dirty()}>
                  <span
                    class="size-1.5 shrink-0 rounded-full bg-primary"
                    title={t("projectDetail.unsavedChanges") as string}
                  />
                </Show>
                <button
                  type="button"
                  class="ml-0.5 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted/60 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label={t("projectDetail.closeFile") as string}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.model.requestClose(tab.path);
                  }}
                >
                  <span class="iconify mdi--close size-3" aria-hidden="true" />
                </button>
              </div>
            );
          }}
        </For>
      </div>
      <div class="flex shrink-0 items-center gap-0.5 border-l border-border/40 px-1">
        <Tooltip>
          <TooltipTrigger
            as="button"
            type="button"
            class="rounded p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground disabled:opacity-40"
            disabled={!props.model.hasDirtyTabs()}
            onClick={() => void props.model.saveAll()}
            aria-label={t("projectDetail.saveAll") as string}
          >
            <span class="iconify mdi--content-save-all-outline size-3.5" aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>{t("projectDetail.saveAll") as string}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            as="button"
            type="button"
            class="rounded p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            onClick={() => props.model.closeAll()}
            aria-label={t("projectDetail.closeAllFiles") as string}
          >
            <span class="iconify mdi--close-box-multiple-outline size-3.5" aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>{t("projectDetail.closeAllFiles") as string}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
