import { EditorView } from "@codemirror/view";
import { gotoLine as cmGotoLine, openSearchPanel } from "@codemirror/search";

/**
 * Imperative handle for an editor instance. Owns navigation and document
 * access; the parent owns persistence and tab state.
 */
export type CodeEditorApi = {
  view: () => EditorView | undefined;
  focus: () => void;
  getText: () => string;
  setText: (text: string) => void;
  goToLine: (line: number) => void;
  openGoToLine: () => void;
  openSearch: () => void;
  format: () => void;
};

export function createCodeEditorApi(
  getView: () => EditorView | undefined,
  fallbackText: () => string,
  format: () => void,
): CodeEditorApi {
  const goToLine = (line: number) => {
    const view = getView();
    if (!view) return;
    const total = view.state.doc.lines;
    const clamped = Math.min(Math.max(1, Number.isFinite(line) ? line : 1), total);
    const target = view.state.doc.line(clamped);
    view.dispatch({
      selection: { anchor: target.from },
      effects: EditorView.scrollIntoView(target.from, { y: "center" }),
    });
    view.focus();
  };

  return {
    view: getView,
    focus: () => getView()?.focus(),
    getText: () => getView()?.state.doc.toString() ?? fallbackText(),
    setText: (text: string) => {
      const view = getView();
      if (!view) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      });
    },
    goToLine,
    openGoToLine: () => {
      const view = getView();
      if (!view) return;
      cmGotoLine(view);
      view.focus();
    },
    openSearch: () => {
      const view = getView();
      if (!view) return;
      openSearchPanel(view);
      view.focus();
    },
    format,
  };
}
