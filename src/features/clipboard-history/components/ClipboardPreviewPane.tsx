import { For, Show, type Component } from "solid-js";
import type { ClipboardEntryDto } from "~/types/dto";

export type ClipboardPreviewPaneProps = Readonly<{
  entry: ClipboardEntryDto | null;
  editMode: boolean;
  editText: string;
  onEditTextChange: (v: string) => void;
  t: (key: string) => string;
}>;

export const ClipboardPreviewPane: Component<ClipboardPreviewPaneProps> = (props) => {
  return (
    <div class="flex min-h-0 w-full flex-col border-t border-border bg-muted/20">
      <div class="shrink-0 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {props.t("clipboardHistory.preview")}
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <Show
          when={props.entry}
          fallback={
            <p class="text-xs text-muted-foreground">{props.t("clipboardHistory.selectEntry")}</p>
          }
        >
          {(entry) => (
            <Show
              when={props.editMode && (entry().kind === "text" || entry().kind === "html")}
              fallback={
                <>
                  <Show when={entry().kind === "text" || entry().kind === "html"}>
                    <pre class="w-full whitespace-pre-wrap break-words rounded-md border border-border/50 bg-background p-3 font-mono text-xs leading-relaxed text-foreground/90">
                      {entry().contentText ?? entry().preview}
                    </pre>
                  </Show>
                  <Show when={entry().kind === "files"}>
                    <ul class="w-full space-y-2">
                      <For each={entry().meta.filePaths}>
                        {(path) => (
                          <li class="flex items-start gap-2 rounded-md border border-border/50 bg-background p-2 text-xs">
                            <span class="iconify mdi--file-outline mt-0.5 size-3.5 shrink-0 opacity-60" />
                            <span class="break-all font-mono text-foreground/85">{path}</span>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                  <Show when={entry().kind === "image"}>
                    <div class="flex w-full flex-col items-center justify-center gap-2 rounded-md border border-border/50 bg-background p-6 text-center">
                      <span class="iconify mdi--image size-12 text-muted-foreground/50" />
                      <p class="text-sm text-muted-foreground">{entry().preview}</p>
                      <Show when={entry().meta.byteSize}>
                        <p class="text-[10px] text-muted-foreground">
                          {Math.round((entry().meta.byteSize ?? 0) / 1024)} KB
                        </p>
                      </Show>
                    </div>
                  </Show>
                </>
              }
            >
              <textarea
                class="min-h-[120px] w-full resize-none rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed outline-none focus:ring-1 focus:ring-primary"
                value={props.editText}
                onInput={(e) => props.onEditTextChange(e.currentTarget.value)}
              />
            </Show>
          )}
        </Show>
      </div>
    </div>
  );
};
