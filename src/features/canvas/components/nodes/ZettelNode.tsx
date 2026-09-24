import {
  Show,
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from "solid-js";
import { CanvasNodeContainer, type CanvasNodeComponentProps } from "./CanvasNodeContainer";
import { onMarkdownCopyClick } from "~/lib/markdown-copy";
import { renderMarkdownHtml } from "~/services/markdown";

export const DEFAULT_ZETTEL =
  "# New zettel\n\nWrite one idea here. **Click to edit**, `Esc` or blur to render.";

export const ZettelNode: Component<CanvasNodeComponentProps> = (props) => {
  const initial = () => props.node.dataJson ?? DEFAULT_ZETTEL;
  const [draft, setDraft] = createSignal(initial());
  const [editing, setEditing] = createSignal(false);

  // Sync when switching layouts/projects (store is the source of truth).
  createEffect(() => {
    setDraft(props.node.dataJson ?? DEFAULT_ZETTEL);
  });

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const persist = (next: string) => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (next !== (props.node.dataJson ?? DEFAULT_ZETTEL)) {
        props.onDataChange?.(props.node.id, next);
      }
    }, 500);
  };
  onCleanup(() => {
    if (saveTimer) clearTimeout(saveTimer);
  });

  const [html] = createResource(draft, async (text) => await renderMarkdownHtml(text));

  // Copy-button support for rendered code blocks (mirrors IssueMarkdown).
  let previewRef: HTMLDivElement | undefined;
  const handleCopyClick = (e: MouseEvent) => {
    void onMarkdownCopyClick(e);
  };
  onMount(() => {
    previewRef?.addEventListener("click", handleCopyClick);
  });
  onCleanup(() => {
    previewRef?.removeEventListener("click", handleCopyClick);
  });

  const enterEdit = (e: MouseEvent) => {
    // Links, code copy buttons, and code selections stay interactive —
    // only plain preview surface enters edit mode.
    const t = e.target as HTMLElement;
    if (t.closest("a, button, pre, code")) return;
    e.stopPropagation();
    setEditing(true);
  };

  let textareaRef: HTMLTextAreaElement | undefined;
  createEffect(() => {
    if (editing() && textareaRef) {
      textareaRef.focus();
      textareaRef.setSelectionRange(textareaRef.value.length, textareaRef.value.length);
    }
  });

  return (
    <CanvasNodeContainer
      node={props.node}
      icon="mdi--card-text-outline"
      badge="Zettel"
      isDraggable={props.isDraggable}
      snapEnabled={props.snapEnabled}
      zoom={props.zoom}
      onPositionChange={props.onPositionChange}
      onResize={props.onResize}
      onDelete={props.onDelete}
      onPinToggle={props.onPinToggle}
      isFocused={props.isFocused}
      isFullscreen={props.isFullscreen}
      onFocusNode={props.onFocusNode}
      onToggleFullscreen={props.onToggleFullscreen}
      onTitleChange={props.onTitleChange}
      onStartDrag={props.onStartDrag}
    >
      <div class="flex items-center justify-end pb-1 text-[10px] text-muted-foreground/70">
        <Show
          when={editing()}
          fallback={<span title="Click the note to edit">Preview — click to edit</span>}
        >
          <span>Editing — blur or Esc to render</span>
        </Show>
      </div>
      <Show
        when={editing()}
        fallback={
          <div
            ref={(el) => (previewRef = el)}
            onClick={enterEdit}
            title="Click to edit"
            class="min-h-28 w-full flex-1 cursor-text overflow-auto rounded border border-transparent p-2 hover:border-border/40"
          >
            <Show
              when={html()}
              fallback={<p class="animate-pulse text-xs text-muted-foreground">Rendering…</p>}
            >
              <article class="markdown-body !bg-transparent !p-0 text-xs" innerHTML={html()!} />
            </Show>
          </div>
        }
      >
        <textarea
          ref={(el) => (textareaRef = el)}
          value={draft()}
          onInput={(e) => {
            const next = e.currentTarget.value;
            setDraft(next);
            persist(next);
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.currentTarget.blur();
            }
            e.stopPropagation();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          placeholder="Write markdown…"
          class="min-h-28 w-full flex-1 resize-none rounded border border-border/40 bg-background/50 p-2 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
      </Show>
    </CanvasNodeContainer>
  );
};
