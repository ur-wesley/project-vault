import { Show, createEffect, type Component } from "solid-js";

import type { WhiteboardLabels } from "./whiteboard/useWhiteboardLabels";
import type { WhiteboardStore } from "./whiteboard/useWhiteboardStore";
import { fontStackFor, TEXT_LINE_HEIGHT, measureTextBlock } from "./whiteboard/textMeasure";

/**
 * Label-edit overlay (positioned inside the relative board div).
 * Styled from the edited label's own style and sized from the shared
 * text measurement, so the popup sits on the element exactly like the
 * rendered label (no scrollHeight race, no tool-style mismatch).
 */
export const WhiteboardOverlays: Component<{
  labels: WhiteboardLabels;
  store: WhiteboardStore;
}> = (props) => {
  const { labels, store } = props;

  createEffect(() => {
    labels.focusTextInput();
  });

  return (
    <Show when={labels.labelEdit()}>
      {(edit) => {
        const bound = !!edit().containerId;
        const fixedW = edit().width;
        const st = labels.editStyle();
        const stack = fontStackFor(st.fontFamily);
        const z = store.zoom();
        const screen = () => store.worldToScreen(edit().at.x, edit().at.y);
        // Arrow-label edits render as a centered pill (mirrors the painted
        // midpoint pill in paint.ts) instead of a plain textarea.
        const container = () =>
          edit().containerId
            ? store.elements().find((e) => e.id === edit().containerId)
            : undefined;
        const arrowLabel = () => {
          const c = container();
          return !!c && (c.type === "arrow" || c.type === "line");
        };
        const wrap = fixedW ?? (bound ? 220 : null);
        const block = () =>
          measureTextBlock(labels.textValue() || " ", st.fontSize, wrap, {
            fontFamily: st.fontFamily,
          });
        const lineH = () => st.fontSize * TEXT_LINE_HEIGHT;
        const editWidth = (): string => {
          if (fixedW || bound) {
            const content = Math.max(block().width + 24, bound ? 80 : 40);
            return `${Math.min(content, 320) * z}px`;
          }
          return "auto";
        };
        const editHeight = () => `${(block().lines.length * lineH() + 12) * z}px`;
        return (
          <textarea
            ref={(el) => labels.setTextInputRef(el)}
            value={labels.textValue()}
            onInput={(e) => labels.setTextValue(e.currentTarget.value)}
            onBlur={labels.commitLabel}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                e.preventDefault();
                labels.commitLabel();
              } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                labels.commitLabel();
              }
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onDblClick={(e) => e.stopPropagation()}
            placeholder={edit().containerId ? "Label text, Esc to place" : "Type text, Esc to place"}
            rows={1}
            class="absolute z-10 rounded border border-primary/50 bg-background px-1.5 py-1 text-foreground focus:outline-none"
            style={{
              left: `${screen().x}px`,
              top: `${screen().y}px`,
              transform: bound ? "translate(-50%, -50%)" : "translate(0, -50%)",
              width: editWidth(),
              "min-width": bound ? `${80 * z}px` : `${32 * z}px`,
              "max-width": `${320 * z}px`,
              height: editHeight(),
              "border-radius": arrowLabel() ? "9999px" : undefined,
              "text-align": bound ? "center" : st.textAlign,
              "white-space": "pre-wrap",
              "overflow-wrap": "break-word",
              overflow: "hidden",
              resize: "none",
              "font-size": `${st.fontSize * z}px`,
              "line-height": "1.25",
              "font-family": stack,
              color: st.strokeColor,
            }}
          />
        );
      }}
    </Show>
  );
};
