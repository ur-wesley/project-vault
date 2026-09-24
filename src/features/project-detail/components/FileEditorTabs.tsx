import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { createStore } from "solid-js/store";

import { useI18n } from "~/lib/i18n-context";
import { useEventHub } from "~/lib/event-hub-context";
import { chord, useScopedShortcut } from "~/lib/use-scoped-shortcut";

import { EditorTabStrip } from "./EditorTabStrip";
import { EditorToolbar } from "./EditorToolbar";
import { EditorSurface } from "./EditorSurface";
import { ExternalChangeBanner } from "./ExternalChangeBanner";
import { UnsavedCloseDialog } from "./UnsavedCloseDialog";
import type { FileTabsModel } from "../model/fileTabsModel";
import type { CodeEditorApi } from "../lib/editor-api";

/**
 * Composition shell for the editor stack. Owns the editor api registry,
 * minimap/cursor UI state and shortcut wiring; rendering is delegated to
 * EditorTabStrip / EditorToolbar / EditorSurface / banners / dialogs.
 */
export function FileEditorTabs(props: {
  model: FileTabsModel;
  projectRoot: string;
  /** False while an overlay (search / directory / empty) covers the editor. */
  active: boolean;
  /** Increment `nonce` to jump the given file to a line. */
  scrollRequest?: { path: string; line: number; nonce: number };
  onNavigate?: (path: string, isDirectory?: boolean) => void;
  onBackToResults?: () => void;
  backLabel?: string;
}) {
  const { t } = useI18n();
  const hub = useEventHub();
  const [apis, setApis] = createStore<Record<string, CodeEditorApi>>({});
  const [minimapOpen, setMinimapOpen] = createSignal(
    localStorage.getItem("pv-files-minimap") !== "false",
  );
  const [cursor, setCursor] = createSignal<{ line: number; column: number }>({
    line: 1,
    column: 1,
  });
  // Per-tab code/preview view mode. Defaults to code; stale entries for
  // closed tabs are harmless and preserve the mode if the file reopens.
  const [viewModes, setViewModes] = createSignal<Record<string, "code" | "preview">>({});
  const viewModeOf = (path: string): "code" | "preview" => viewModes()[path] ?? "code";

  createEffect(() => {
    try {
      localStorage.setItem("pv-files-minimap", String(minimapOpen()));
    } catch {
      // ignore persistence failures
    }
  });

  const activePath = () => props.model.activeTab()?.path ?? null;
  const activeApi = () => {
    const path = activePath();
    return path ? apis[path] : undefined;
  };

  const registerApi = (path: string, api: CodeEditorApi) => setApis(path, api);
  const removeApi = (path: string) =>
    setApis((prev) => {
      if (!(path in prev)) return prev;
      const next = { ...prev };
      delete next[path];
      return next;
    });

  // Deep-link / search-result jumps: scroll the target editor to the line.
  createEffect(() => {
    const request = props.scrollRequest;
    if (!request || request.line <= 0) return;
    const api = apis[request.path];
    if (!api) return;
    requestAnimationFrame(() => api.goToLine(request.line));
  });

  // Scoped close-tab for the whole files surface, editor included.
  useScopedShortcut({
    scope: "files",
    includeNested: ["editor"],
    match: chord("w"),
    enabled: () => props.active,
    handler: () => {
      const path = activePath();
      if (path) props.model.requestClose(path);
    },
  });

  onMount(() => {
    const unlistenWatch = props.model.initWatcher();
    // Registry-dispatched file actions (rebindable in Settings). Save and
    // close are model-level and live in FileTree; find/goto/format need the
    // editor apis owned here.
    const unsub = hub.on("shortcut:action", ({ action }) => {
      if (!props.active) return;
      const api = activeApi();
      const path = activePath();
      if (action === "file:find") api?.openSearch();
      else if (action === "file:goto-line") api?.openGoToLine();
      else if (action === "file:format") {
        if (path && !props.model.state.readOnly[path]) api?.format();
      }
    });
    onCleanup(() => {
      unlistenWatch();
      unsub();
    });
  });

  return (
    <div
      data-shortcut-scope="files"
      class="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border/40 bg-card/50"
    >
      <EditorTabStrip
        model={props.model}
        activePath={activePath()}
        onPin={(p) => props.model.pinTab(p)}
      />

      <Show when={activePath()}>
        {(path) => (
          <>
            <EditorToolbar
              model={props.model}
              activePath={path()}
              projectRoot={props.projectRoot}
              cursor={cursor()}
              minimapOpen={minimapOpen()}
              onToggleMinimap={() => setMinimapOpen((open) => !open)}
              getApi={(p) => apis[p]}
              viewMode={viewModeOf(path())}
              onViewMode={(mode) => setViewModes((prev) => ({ ...prev, [path()]: mode }))}
              onBackToResults={props.onBackToResults}
              backLabel={props.backLabel ?? (t("projectDetail.searchResults") as string)}
            />
            <Show when={props.model.state.externalChanged[path()]}>
              <ExternalChangeBanner model={props.model} activePath={path()} />
            </Show>
          </>
        )}
      </Show>

      <EditorSurface
        model={props.model}
        activePath={activePath()}
        projectRoot={props.projectRoot}
        minimapOpen={minimapOpen()}
        cursorLine={cursor().line}
        scrollRequest={props.scrollRequest}
        onNavigate={props.onNavigate}
        onApiReady={registerApi}
        onApiDispose={removeApi}
        getApi={(p) => apis[p]}
        viewModeOf={viewModeOf}
        onCursor={(line, column) => setCursor({ line, column })}
      />

      <UnsavedCloseDialog model={props.model} />
    </div>
  );
}
