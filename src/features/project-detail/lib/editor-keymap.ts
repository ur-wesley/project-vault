import { keymap } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { EditorState } from "@codemirror/state";
import {
  closeBracketsKeymap,
  completionKeymap,
  closeBrackets,
  autocompletion,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
} from "@codemirror/view";
import {
  gotoLine as cmGotoLine,
  highlightSelectionMatches,
  search,
  searchKeymap,
} from "@codemirror/search";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";

export type EditorKeyActions = {
  onSave: () => void;
  onFormat: () => void;
};

/**
 * Editor-local keymap. Custom bindings set `stopPropagation` so a
 * user-configured app shortcut on the same chord never double-fires while the
 * editor is focused. Every other binding relies on CodeMirror's
 * `preventDefault`, which the app-level listener respects (see the
 * consume-guard in shortcut-context).
 */
export function createEditorKeymap(actions: EditorKeyActions): Extension {
  return keymap.of([
    {
      key: "Mod-s",
      preventDefault: true,
      stopPropagation: true,
      run: () => {
        actions.onSave();
        return true;
      },
    },
    {
      key: "Mod-g",
      preventDefault: true,
      stopPropagation: true,
      run: (target) => cmGotoLine(target),
    },
    {
      key: "Shift-Alt-f",
      preventDefault: true,
      stopPropagation: true,
      run: () => {
        actions.onFormat();
        return true;
      },
    },
    indentWithTab,
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...foldKeymap,
    ...completionKeymap,
  ]);
}

/** Everything except the keymap: gutters, editing behavior, search, theme. */
export function createEditorBaseExtensions(theme: Extension): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    indentUnit.of("  "),
    EditorState.tabSize.of(2),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true }),
    syntaxHighlighting(oneDarkHighlightStyle),
    theme,
  ];
}
