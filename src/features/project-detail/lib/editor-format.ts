import type { EditorView } from "@codemirror/view";
import { indentRange } from "@codemirror/language";

/**
 * Remove trailing spaces/tabs on every line and collapse the file to a single
 * trailing newline. Pure string transform — unit-tested, no editor needed.
 */
export function trimTrailingWhitespace(text: string): string {
  const lines = text.split("\n");
  const trimmed = lines.map((line) => line.replace(/[ \t]+$/, ""));
  let end = trimmed.length;
  while (end > 1 && trimmed[end - 1] === "") end -= 1;
  return trimmed.slice(0, end).join("\n") + "\n";
}

/**
 * Format the whole document in two undo steps: whitespace cleanup first, then
 * a re-indent pass through the language's indent service.
 */
export function formatEditorView(view: EditorView): void {
  const before = view.state.doc.toString();
  const trimmed = trimTrailingWhitespace(before);
  if (trimmed !== before) {
    const anchor = Math.min(view.state.selection.main.anchor, trimmed.length);
    view.dispatch({
      changes: { from: 0, to: before.length, insert: trimmed },
      selection: { anchor },
    });
  }

  const indentChanges = indentRange(view.state, 0, view.state.doc.length);
  if (indentChanges.empty) return;
  view.dispatch({
    changes: indentChanges,
    selection: { anchor: view.state.selection.main.anchor },
  });
}
