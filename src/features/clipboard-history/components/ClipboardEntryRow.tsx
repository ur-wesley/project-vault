import { Show, type Component } from "solid-js";
import { createQuery } from "@tanstack/solid-query";
import type { ClipboardEntryDto } from "~/types/dto";
import { cn } from "~/lib/utils";
import { getClipboardEntryThumbnail } from "~/services/tauri/clipboard-history";

const KIND_ICON: Record<string, string> = {
  text: "mdi--text",
  html: "mdi--language-html5",
  image: "mdi--image",
  files: "mdi--file-multiple",
};

export type ClipboardEntryRowProps = Readonly<{
  entry: ClipboardEntryDto;
  selected: boolean;
  onPointerMove: () => void;
  onApply: () => void;
}>;

export const ClipboardEntryRow: Component<ClipboardEntryRowProps> = (props) => {
  const icon = () => KIND_ICON[props.entry.kind] ?? "mdi--clipboard-text";
  const isImage = () => props.entry.kind === "image";

  const thumbQ = createQuery(() => ({
    queryKey: ["clipboard", "thumb", props.entry.id],
    enabled: isImage(),
    staleTime: 60_000,
    queryFn: async () => {
      const r = await getClipboardEntryThumbnail(props.entry.id, 56);
      if (r.isErr()) return null;
      return r.value;
    },
  }));

  return (
    <button
      type="button"
      data-clip-item
      class={cn(
        "flex w-full items-center gap-3.5 rounded-sm px-5 py-4 text-left text-sm transition-colors",
        props.selected
          ? "bg-primary/15 text-foreground ring-1 ring-primary/25"
          : "text-foreground/90 hover:bg-accent/50",
      )}
      onClick={() => props.onApply()}
      onPointerMove={() => props.onPointerMove()}
    >
      <Show
        when={isImage() && thumbQ.data}
        fallback={
          <span class={cn("iconify size-4 shrink-0 opacity-70", icon())} />
        }
      >
        <img
          src={thumbQ.data!}
          alt=""
          class="size-10 shrink-0 rounded-sm border border-border/60 bg-muted/40 object-cover"
        />
      </Show>
      <div class="flex min-w-0 flex-1 items-center gap-1.5">
        <span class="truncate font-medium">{props.entry.preview}</span>
        {props.entry.pinned && (
          <span class="iconify mdi--pin size-3 shrink-0 text-primary" title="Pinned" />
        )}
      </div>
    </button>
  );
};
