import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

/**
 * Editor chrome theme. Reads the app's CSS tokens so the editor follows the
 * active theme without a separate light/dark CodeMirror build. Token colors
 * come from the one-dark highlight style applied alongside this theme.
 */
export function createEditorTheme(): Extension {
  return EditorView.theme(
    {
      "&": {
        height: "100%",
        color: "var(--foreground)",
        backgroundColor: "transparent",
        fontSize: "12px",
      },
      ".cm-scroller": {
        fontFamily: "var(--font-mono)",
        lineHeight: "1.6",
        overflow: "auto",
      },
      ".cm-content": {
        caretColor: "var(--primary)",
        paddingBottom: "40vh",
      },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--primary)" },
      "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
        { backgroundColor: "color-mix(in oklch, var(--primary) 28%, transparent)" },
      ".cm-activeLine": {
        backgroundColor: "color-mix(in oklch, var(--muted) 55%, transparent)",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "color-mix(in oklch, var(--muted) 55%, transparent)",
      },
      ".cm-gutters": {
        backgroundColor: "transparent",
        color: "color-mix(in oklch, var(--muted-foreground) 70%, transparent)",
        border: "none",
        borderRight: "1px solid color-mix(in oklch, var(--border) 60%, transparent)",
      },
      ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 4px" },
      ".cm-foldGutter .cm-gutterElement": { padding: "0 2px" },
      ".cm-panels": {
        backgroundColor: "var(--popover)",
        color: "var(--popover-foreground)",
        borderTop: "1px solid var(--border)",
      },
      ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
      ".cm-searchMatch": {
        backgroundColor: "color-mix(in oklch, var(--warning) 35%, transparent)",
      },
      ".cm-searchMatch.cm-searchMatch-selected": {
        backgroundColor: "color-mix(in oklch, var(--primary) 45%, transparent)",
      },
      ".cm-selectionMatch": {
        backgroundColor: "color-mix(in oklch, var(--primary) 22%, transparent)",
      },
      ".cm-tooltip": {
        backgroundColor: "var(--popover)",
        color: "var(--popover-foreground)",
        border: "1px solid var(--border)",
      },
      ".cm-tooltip-autocomplete ul li[aria-selected]": {
        backgroundColor: "var(--accent)",
        color: "var(--accent-foreground)",
      },
    },
    { dark: true },
  );
}
