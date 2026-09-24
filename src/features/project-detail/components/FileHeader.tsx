import { Show, type Component } from "solid-js";
import type { Accessor } from "solid-js";

import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { formatBytes } from "~/lib/format-bytes";
import type { useI18n } from "~/lib/i18n-context";
import { FileIcon } from "~/components/FileIcon";
import type { FileContentModel } from "../model/useFileContent";

type T = ReturnType<typeof useI18n>["t"];

/**
 * File header bar: back button, filename, markdown preview/code toggle,
 * line + size badges. (Extracted verbatim from FilePreview.)
 */
export const FileHeader: Component<{
  t: T;
  path: Accessor<string | null>;
  content: FileContentModel["content"];
  viewMode: Accessor<"preview" | "code">;
  setViewMode: (mode: "preview" | "code") => void;
  onBackToResults?: () => void;
  backLabel?: string;
}> = (props) => {
  return (
    <div class="flex items-center justify-between px-3 py-1.5 bg-muted/20 border-b border-border/40 shrink-0 gap-3">
      <div class="flex items-center gap-2 min-w-0">
        <Show when={props.onBackToResults}>
          <Tooltip>
            <TooltipTrigger
              as="button"
              type="button"
              class="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
              onClick={props.onBackToResults}
            >
              <span class="iconify mdi--arrow-left h-3.5 w-3.5" />
            </TooltipTrigger>
            <TooltipContent>
              {props.backLabel ?? (props.t("projectDetail.searchResults") as string)}
            </TooltipContent>
          </Tooltip>
        </Show>
        <FileIcon name={props.path()?.split(/[\\/]/).pop() ?? ""} class="h-3.5 w-3.5" />
        <span class="text-[10px] font-mono text-muted-foreground truncate">
          {props.path()?.split(/[\\/]/).pop() ??
            (props.t("projectDetail.noFileSelected") as string)}
        </span>
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <Show when={props.content() && props.content()!.isMarkdown}>
          <div class="flex items-center bg-muted/40 rounded-md p-0.5 border border-border/10">
            <button
              type="button"
              class={cn(
                "px-2 py-0.5 rounded text-[10px] font-semibold transition-all cursor-pointer",
                props.viewMode() === "preview"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => props.setViewMode("preview")}
            >
              Preview
            </button>
            <button
              type="button"
              class={cn(
                "px-2 py-0.5 rounded text-[10px] font-semibold transition-all cursor-pointer",
                props.viewMode() === "code"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => props.setViewMode("code")}
            >
              Code
            </button>
          </div>
        </Show>

        <Show when={props.content() && props.content()!.loc > 0}>
          <span class="text-[9px] font-mono text-muted-foreground/60 uppercase tracking-wider">
            {props.t("projectDetail.fileLines", { count: props.content()!.loc }) as string}
          </span>
        </Show>
        <Show when={props.content()?.fileSize != null && props.content()?.mediaKind}>
          <span class="text-[9px] font-mono text-muted-foreground/60 uppercase tracking-wider">
            {formatBytes(props.content()!.fileSize!)}
          </span>
        </Show>
      </div>
    </div>
  );
};
