import { Show, createEffect, onCleanup } from "solid-js";

import { useI18n } from "~/lib/i18n-context";
import { cn } from "~/lib/utils";
import { createFileContentModel, type FilePreviewContent } from "../model/useFileContent";
import { createPreviewScroll } from "../model/usePreviewScroll";
import { FileHeader } from "./FileHeader";
import { MarkdownView } from "./MarkdownView";
import { MediaView } from "./MediaView";
import { DirectoryList } from "./DirectoryList";

export type { FilePreviewContent };

export function FilePreview(props: {
  path: string | null;
  projectRoot?: string;
  scrollToLine?: number;
  /**
   * Fallback query string used when the backend couldn't produce a line
   * number (path-only matches). We split the query on the same delimiters
   * the search index uses, then jump to the first line of the file that
   * contains any of the resulting tokens.
   */
  scrollToQuery?: string;
  onBackToResults?: () => void;
  backLabel?: string;
  /**
   * Called when a breadcrumb or a row in the directory listing is activated.
   * The second argument is `true` for directories and `false` for files,
   * letting the host decide between browsing and opening an editor tab.
   */
  onNavigate?: (path: string, isDirectory?: boolean) => void;
  /**
   * Embedded mode (e.g. canvas file node): skip the outer card chrome
   * (rounded border + tinted background) since the host already provides
   * a frame. Inner header, badges and content are unchanged.
   */
  bare?: boolean;
}) {
  const { t } = useI18n();

  const path = () => props.path;
  const model = createFileContentModel({ path, t });
  createPreviewScroll({
    content: model.content,
    viewMode: model.viewMode,
    setViewMode: model.setViewMode,
    path,
    scrollToLine: () => props.scrollToLine,
    scrollToQuery: () => props.scrollToQuery,
  });

  createEffect(() => {
    const c = model.content();
    const url = c?.mediaUrl;
    onCleanup(() => {
      if (url) URL.revokeObjectURL(url);
    });
  });

  return (
    <div
      class={cn(
        "h-full flex flex-col min-w-0 overflow-hidden",
        props.bare ? "bg-transparent" : "bg-card/50 rounded-md border border-border/40",
      )}
    >
      <Show
        when={model.content() && model.content()!.isDirectory}
        fallback={
          <>
            <FileHeader
              t={t}
              path={path}
              content={model.content}
              viewMode={model.viewMode}
              setViewMode={model.setViewMode}
              onBackToResults={props.onBackToResults}
              backLabel={props.backLabel}
            />
            <div
              class={cn(
                "flex-1 min-h-0",
                model.content()?.mediaKind === "pdf" ? "overflow-hidden" : "overflow-auto",
              )}
            >
              <Show
                when={model.content()}
                fallback={
                  <div class="p-3 text-muted-foreground italic text-[11px] font-mono">
                    {t("projectDetail.selectFilePreview") as string}
                  </div>
                }
              >
                {(c) => (
                  <Show
                    when={c().mediaKind}
                    fallback={<MarkdownView content={model.content} viewMode={model.viewMode} />}
                  >
                    <MediaView t={t} path={path} content={model.content} />
                  </Show>
                )}
              </Show>
            </div>
          </>
        }
      >
        <DirectoryList
          t={t}
          path={path}
          projectRoot={() => props.projectRoot}
          content={model.content}
          onNavigate={props.onNavigate}
        />
      </Show>
    </div>
  );
}
