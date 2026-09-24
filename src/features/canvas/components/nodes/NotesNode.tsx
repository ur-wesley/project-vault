import { createEffect, createSignal, type Component } from "solid-js";
import { CanvasNodeContainer, type CanvasNodeComponentProps } from "./CanvasNodeContainer";

const DEFAULT_NOTES =
  "- Implement canvas multi-window flyout\n- Verify monitor bounds sync\n- Check Jira status";

export const NotesNode: Component<CanvasNodeComponentProps> = (props) => {
  const initial = () => props.node.dataJson ?? DEFAULT_NOTES;
  const [noteText, setNoteText] = createSignal(initial());

  // Sync when switching layouts/projects (store is the source of truth).
  createEffect(() => {
    setNoteText(props.node.dataJson ?? DEFAULT_NOTES);
  });

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const persist = (next: string) => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (next !== (props.node.dataJson ?? DEFAULT_NOTES)) {
        props.onDataChange?.(props.node.id, next);
      }
    }, 500);
  };

  return (
    <CanvasNodeContainer
      node={props.node}
      icon="mdi--notebook-outline"
      badge="Notes"
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
      <textarea
        value={noteText()}
        onInput={(e) => {
          const next = e.currentTarget.value;
          setNoteText(next);
          persist(next);
        }}
        placeholder="Write scratchpad notes, architecture links, or commands here..."
        class="min-h-28 w-full flex-1 resize-none rounded border border-border/40 bg-background/50 p-2 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/50"
      />
    </CanvasNodeContainer>
  );
};
