import { EditorState, Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { onCleanup, onMount, createEffect } from "solid-js";

import { resolveEditorLanguage } from "../lib/file-editor";
import { createEditorTheme } from "../lib/editor-theme";
import { createEditorBaseExtensions, createEditorKeymap } from "../lib/editor-keymap";
import { formatEditorView } from "../lib/editor-format";
import { createCodeEditorApi, type CodeEditorApi } from "../lib/editor-api";

/**
 * Thin Solid wrapper around a CodeMirror 6 instance. Owns the view lifecycle
 * and reactive compartments; language, theme, keymap, format and the public
 * api live in `../lib/editor-*` so they stay independently testable.
 */
export function CodeEditor(props: {
  path: string;
  value: string;
  /** Bump to force the editor to adopt `value` (external reload). */
  reloadToken?: number;
  readOnly?: boolean;
  scrollToLine?: number;
  onChange?: (text: string) => void;
  onSave?: () => void;
  onCursor?: (line: number, column: number) => void;
  onReady?: (api: CodeEditorApi) => void;
}) {
  const languageCompartment = new Compartment();
  const readOnlyCompartment = new Compartment();

  // eslint-disable-next-line no-unassigned-vars -- Solid ref pattern
  let containerEl: HTMLDivElement | undefined;
  let view: EditorView | undefined;
  let lastReloadToken = props.reloadToken ?? 0;

  onMount(() => {
    if (!containerEl) return;
    view = new EditorView({
      state: EditorState.create({
        doc: props.value,
        extensions: [
          ...createEditorBaseExtensions(createEditorTheme()),
          languageCompartment.of(resolveEditorLanguage(props.path)),
          readOnlyCompartment.of(EditorState.readOnly.of(props.readOnly ?? false)),
          createEditorKeymap({
            onSave: () => props.onSave?.(),
            onFormat: () => {
              if (view) formatEditorView(view);
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              props.onChange?.(update.state.doc.toString());
            }
            if (update.selectionSet || update.docChanged) {
              const head = update.state.selection.main.head;
              const line = update.state.doc.lineAt(head);
              props.onCursor?.(line.number, head - line.from + 1);
            }
          }),
        ],
      }),
      parent: containerEl,
    });

    const api = createCodeEditorApi(
      () => view,
      () => props.value,
      () => {
        if (view && !props.readOnly) formatEditorView(view);
      },
    );
    if (props.scrollToLine && props.scrollToLine > 0) {
      api.goToLine(props.scrollToLine);
    }
    props.onReady?.(api);
  });

  createEffect(() => {
    const token = props.reloadToken ?? 0;
    if (token === lastReloadToken) return;
    lastReloadToken = token;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === props.value) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: props.value },
    });
  });

  createEffect(() => {
    const readOnly = props.readOnly ?? false;
    view?.dispatch({
      effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  });

  createEffect(() => {
    const path = props.path;
    view?.dispatch({
      effects: languageCompartment.reconfigure(resolveEditorLanguage(path)),
    });
  });

  onCleanup(() => {
    view?.destroy();
    view = undefined;
  });

  return (
    <div
      ref={containerEl}
      data-shortcut-scope="editor"
      class="h-full min-h-0 w-full overflow-hidden"
    />
  );
}

export type { CodeEditorApi };
