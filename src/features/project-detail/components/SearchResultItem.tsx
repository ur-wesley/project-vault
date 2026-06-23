import { For, Show, createMemo } from "solid-js";
import { join } from "@tauri-apps/api/path";
import { useI18n } from "~/lib/i18n-context";
import type { SearchHitDto } from "~/types/dto";
import { FileIcon } from "~/components/FileIcon";
import { cn } from "~/lib/utils";

export function SearchResultItem(props: {
  hit: SearchHitDto;
  rootPath: string;
  topScore: number;
  onClick: (path: string, line: number) => void;
}) {
  const { t } = useI18n();
  const hitCount = () => props.hit.lineNumbers.length;

  const absPath = createMemo(async () => {
    try {
      return await join(props.rootPath, props.hit.path);
    } catch {
      return null;
    }
  });

  const handleLineClick = async (e: MouseEvent, line: number) => {
    e.stopPropagation();
    const p = await absPath();
    if (p) props.onClick(p, line);
  };

  const handleCardClick = async () => {
    const p = await absPath();
    if (!p) return;
    const line = props.hit.lineNumbers.length > 0 ? props.hit.lineNumbers[0] : 0;
    props.onClick(p, line);
  };

  // Tantivy's snippet HTML is safe — user content is escaped, only the
  // wrapper tag is HTML — so we can assign via `innerHTML` on a ref.
  const setSnippetHtml = (el: HTMLSpanElement) => {
    el.innerHTML = "";
    for (const snippet of props.hit.highlights) {
      const wrapper = document.createElement("span");
      wrapper.className = "block";
      wrapper.innerHTML = snippet.html;
      el.appendChild(wrapper);
    }
  };

  // Dim hits whose score is well below the top score in the result set.
  // Threshold mirrors the design doc: 0.3 × topScore.
  const isLowScore = () =>
    props.topScore > 0 && props.hit.score < 0.3 * props.topScore;

  return (
    <div
      class={cn(
        "rounded-md border border-border/50 bg-muted/20 p-2.5 cursor-pointer hover:bg-muted/40 transition-colors",
        isLowScore() && "opacity-60",
      )}
      onClick={handleCardClick}
    >
      <div class="flex items-center justify-between gap-2 mb-1.5">
        <div class="flex items-center gap-1.5 min-w-0">
          <FileIcon name={props.hit.path} class="h-3.5 w-3.5" />
          <span class="text-[11px] font-mono text-foreground/90 truncate">{props.hit.path}</span>
        </div>
        <span class="shrink-0 inline-flex items-center rounded-full bg-primary/20 px-1.5 py-0.5 text-[9px] font-mono font-black text-primary">
          {hitCount() === 1
            ? t("projectDetail.searchHitCount", { count: hitCount() })
            : t("projectDetail.searchHitCountPlural", { count: hitCount() })}
        </span>
      </div>

      <Show when={hitCount() > 0}>
        <div class="flex flex-wrap gap-1 mb-1.5">
          <span class="text-[9px] text-muted-foreground/70 uppercase tracking-wider self-center mr-0.5">{t("projectDetail.searchLinesLabel") as string}</span>
          <For each={props.hit.lineNumbers}>
            {(num) => (
              <button
                type="button"
                class="inline-flex items-center rounded-sm bg-primary/15 px-1 py-0.5 text-[9px] font-mono font-bold text-primary/90 hover:bg-primary/30 transition-colors"
                onClick={(e) => void handleLineClick(e, num)}
              >
                {num}
              </button>
            )}
          </For>
        </div>
      </Show>

      <div class="space-y-1">
        <span ref={setSnippetHtml} class="text-[10px] font-mono text-muted-foreground block" />
        <style>{`.pv-mark { background: rgba(99, 102, 241, 0.22); color: inherit; border-radius: 2px; padding: 0 1px; }`}</style>
      </div>
    </div>
  );
}
