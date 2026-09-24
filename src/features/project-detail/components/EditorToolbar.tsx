import { Show } from "solid-js";

import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { Button } from "~/components/ui/button";
import { useI18n } from "~/lib/i18n-context";
import { cn } from "~/lib/utils";

import { languageLabel, previewKindOf } from "../lib/file-editor";
import { baseNameOfPath, relativeToRoot } from "../lib/file-path-labels";
import type { FileTabsModel } from "../model/fileTabsModel";
import type { CodeEditorApi } from "../lib/editor-api";

/**
 * Toolbar for the active file: breadcrumb, language badge, cursor position
 * and editor commands. All commands route through the editor api so toolbar
 * and keyboard shortcuts share one code path.
 */
export function EditorToolbar(props: {
  model: FileTabsModel;
  activePath: string;
  projectRoot: string;
  cursor: { line: number; column: number };
  minimapOpen: boolean;
  onToggleMinimap: () => void;
  getApi: (path: string) => CodeEditorApi | undefined;
  viewMode: "code" | "preview";
  onViewMode: (mode: "code" | "preview") => void;
  onBackToResults?: () => void;
  backLabel?: string;
}) {
  const { t } = useI18n();
  const api = () => props.getApi(props.activePath);
  const readOnly = () => props.model.state.readOnly[props.activePath] === true;
  const previewKind = () => previewKindOf(props.activePath);

  return (
    <div class="flex shrink-0 items-center justify-between gap-2 border-b border-border/40 bg-muted/10 px-2 py-1">
      <div class="flex min-w-0 items-center gap-2">
        <Show when={props.onBackToResults}>
          <Tooltip>
            <TooltipTrigger
              as="button"
              type="button"
              class="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              onClick={props.onBackToResults}
              aria-label={(props.backLabel ?? t("projectDetail.searchResults")) as string}
            >
              <span class="iconify mdi--arrow-left size-3.5" aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>
              {(props.backLabel ?? t("projectDetail.searchResults")) as string}
            </TooltipContent>
          </Tooltip>
        </Show>
        <span class="truncate font-mono text-[10px] text-muted-foreground">
          {relativeToRoot(props.projectRoot, props.activePath)}
        </span>
        <span class="shrink-0 rounded bg-muted/50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
          {languageLabel(baseNameOfPath(props.activePath))}
        </span>
        <Show when={props.model.state.truncated[props.activePath]}>
          <span class="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-warning">
            {t("projectDetail.fileTruncatedBadge") as string}
          </span>
        </Show>
      </div>
      <div class="flex shrink-0 items-center gap-0.5">
        <span class="mr-1 font-mono text-[10px] text-muted-foreground/70">
          {props.cursor.line}:{props.cursor.column}
        </span>
        <Show when={previewKind() !== null && !readOnly()}>
          <div class="flex items-center rounded-md border border-border/10 bg-muted/40 p-0.5">
            <button
              type="button"
              class={cn(
                "cursor-pointer rounded px-2 py-0.5 text-[10px] font-semibold transition-all",
                props.viewMode === "preview"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => props.onViewMode("preview")}
            >
              Preview
            </button>
            <button
              type="button"
              class={cn(
                "cursor-pointer rounded px-2 py-0.5 text-[10px] font-semibold transition-all",
                props.viewMode === "code"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => props.onViewMode("code")}
            >
              Code
            </button>
          </div>
        </Show>
        <Show when={!readOnly()}>
          <ToolbarButton
            label={t("projectDetail.editorFind") as string}
            icon="mdi--magnify"
            onClick={() => api()?.openSearch()}
          />
          <ToolbarButton
            label={t("projectDetail.editorGoToLine") as string}
            icon="mdi--format-list-numbered"
            onClick={() => api()?.openGoToLine()}
          />
          <ToolbarButton
            label={t("projectDetail.editorFormat") as string}
            icon="mdi--format-align-left"
            onClick={() => api()?.format()}
          />
        </Show>
        <Tooltip>
          <TooltipTrigger
            as="button"
            type="button"
            class={cn(
              "rounded p-1 hover:bg-muted/50",
              props.minimapOpen ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
            aria-pressed={props.minimapOpen}
            onClick={props.onToggleMinimap}
            aria-label={t("projectDetail.editorMinimap") as string}
          >
            <span class="iconify mdi--view-column-outline size-3.5" aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>{t("projectDetail.editorMinimap") as string}</TooltipContent>
        </Tooltip>
        <Show when={props.model.isDirty(props.activePath) && !readOnly()}>
          <Button
            size="sm"
            variant="ghost"
            class="h-6 gap-1 px-1.5 text-[10px] text-primary"
            onClick={() => void props.model.save(props.activePath)}
          >
            <span class="iconify mdi--content-save-outline size-3.5" aria-hidden="true" />
            {t("common.save") as string}
          </Button>
        </Show>
      </div>
    </div>
  );
}

function ToolbarButton(props: { label: string; icon: string; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        as="button"
        type="button"
        class="rounded p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        onClick={props.onClick}
        aria-label={props.label}
      >
        <span class={`iconify ${props.icon} size-3.5`} aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  );
}
