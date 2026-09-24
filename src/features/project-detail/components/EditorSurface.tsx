import { For, Show, onCleanup } from "solid-js";

import { useI18n } from "~/lib/i18n-context";
import { cn } from "~/lib/utils";

import { CodeEditor } from "./CodeEditor";
import { EditorMinimap } from "./EditorMinimap";
import { FilePreview } from "./FilePreview";
import { LivePreview } from "./LivePreview";
import type { FileTabsModel } from "../model/fileTabsModel";
import type { CodeEditorApi } from "../lib/editor-api";
import { previewKindOf } from "../lib/file-editor";

/**
 * Editor surface. Every open tab keeps its CodeEditor mounted (inactive ones
 * hidden) so per-tab undo history and view state survive tab switches and
 * overlay views. The minimap is active-tab-only: it unmounts for background
 * tabs instead of idling a ResizeObserver + canvas loop per tab.
 */
export function EditorSurface(props: {
  model: FileTabsModel;
  activePath: string | null;
  projectRoot: string;
  minimapOpen: boolean;
  cursorLine: number;
  scrollRequest?: { path: string; line: number; nonce: number };
  onNavigate?: (path: string, isDirectory?: boolean) => void;
  onApiReady: (path: string, api: CodeEditorApi) => void;
  onApiDispose: (path: string) => void;
  getApi: (path: string) => CodeEditorApi | undefined;
  viewModeOf: (path: string) => "code" | "preview";
  onCursor: (line: number, column: number) => void;
}) {
  const { t } = useI18n();

  return (
    <div class="relative min-h-0 flex-1">
      <Show
        when={props.activePath}
        fallback={
          <div class="flex h-full items-center justify-center text-[11px] italic text-muted-foreground">
            {t("projectDetail.noOpenFiles") as string}
          </div>
        }
      >
        <For each={props.model.state.tabs}>
          {(tab) => (
            <EditorTabPane
              path={tab.path}
              model={props.model}
              activePath={props.activePath}
              projectRoot={props.projectRoot}
              minimapOpen={props.minimapOpen}
              cursorLine={props.cursorLine}
              scrollLine={
                props.scrollRequest?.path === tab.path ? props.scrollRequest.line : undefined
              }
              onNavigate={props.onNavigate}
              onApiReady={props.onApiReady}
              onApiDispose={props.onApiDispose}
              getApi={props.getApi}
              viewModeOf={props.viewModeOf}
              onCursor={props.onCursor}
            />
          )}
        </For>
      </Show>
    </div>
  );
}

/**
 * One mounted tab. A real component (not an inline `<For>` closure body) so
 * `onCleanup` below is registered on this row's reactive owner and runs
 * exactly when the tab's row is disposed — never ownerless, never stale.
 */
function EditorTabPane(props: {
  path: string;
  model: FileTabsModel;
  activePath: string | null;
  projectRoot: string;
  minimapOpen: boolean;
  cursorLine: number;
  scrollLine?: number;
  onNavigate?: (path: string, isDirectory?: boolean) => void;
  onApiReady: (path: string, api: CodeEditorApi) => void;
  onApiDispose: (path: string) => void;
  getApi: (path: string) => CodeEditorApi | undefined;
  viewModeOf: (path: string) => "code" | "preview";
  onCursor: (line: number, column: number) => void;
}) {
  const { t } = useI18n();

  const isActive = () => props.path === props.activePath;
  const ready = () => props.model.state.loadState[props.path] === "ready";
  const readOnly = () => props.model.state.readOnly[props.path] === true;
  const previewKind = () => previewKindOf(props.path);
  // Preview renders the live buffer; the editor stays mounted
  // underneath so undo history survives toggling.
  const showPreview = () => previewKind() !== null && props.viewModeOf(props.path) === "preview";
  // Active tab only: background tabs pass -1 so a remount never flashes
  // a stale caret, and their minimap stays unmounted entirely.
  const minimapCursorLine = () => (isActive() ? props.cursorLine : -1);

  onCleanup(() => props.onApiDispose(props.path));

  return (
    <div
      class={cn(
        "absolute inset-0 flex min-h-0",
        isActive() ? "z-10" : "invisible pointer-events-none",
      )}
      aria-hidden={!isActive()}
    >
      <Show
        when={ready()}
        fallback={
          <Show when={props.model.state.loadState[props.path] === "error"}>
            <div class="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center">
              <span class="text-[11px] text-destructive">
                {props.model.state.errors[props.path] ??
                  (t("projectDetail.fileLoadFailed") as string)}
              </span>
            </div>
          </Show>
        }
      >
        <Show
          when={!readOnly()}
          fallback={
            <div class="h-full min-h-0 w-full overflow-hidden">
              <FilePreview
                path={props.path}
                projectRoot={props.projectRoot}
                onNavigate={props.onNavigate}
                bare
              />
            </div>
          }
        >
          <div class="flex min-h-0 flex-1 overflow-hidden">
            <div
              class="flex min-h-0 flex-1 overflow-hidden"
              classList={{
                "invisible pointer-events-none absolute inset-0": showPreview(),
              }}
              aria-hidden={showPreview()}
            >
              <div class="min-h-0 flex-1 overflow-hidden">
                <CodeEditor
                  path={props.path}
                  value={props.model.state.contents[props.path] ?? ""}
                  reloadToken={props.model.state.reloadTokens[props.path] ?? 0}
                  scrollToLine={props.scrollLine}
                  onChange={(text) => props.model.setContent(props.path, text)}
                  onSave={() => void props.model.save(props.path)}
                  onCursor={(line, column) => {
                    if (isActive()) props.onCursor(line, column);
                  }}
                  onReady={(api) => props.onApiReady(props.path, api)}
                />
              </div>
              <Show when={props.minimapOpen && isActive()}>
                <EditorMinimap
                  text={props.model.state.contents[props.path] ?? ""}
                  baseline={props.model.state.baselines[props.path]}
                  cursorLine={minimapCursorLine()}
                  getView={() => props.getApi(props.path)?.view()}
                />
              </Show>
            </div>
            <Show when={showPreview()}>
              <div class="min-h-0 flex-1 overflow-hidden">
                <LivePreview
                  kind={previewKind()!}
                  text={props.model.state.contents[props.path] ?? ""}
                />
              </div>
            </Show>
          </div>
        </Show>
      </Show>
    </div>
  );
}
