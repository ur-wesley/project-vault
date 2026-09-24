import { createMemo, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { listen } from "@tauri-apps/api/event";

import {
  createProjectFile,
  createProjectFolder,
  deleteProjectPath,
  readTextFile,
  renameProjectPath,
  writeTextFile,
} from "~/services/tauri/files";
import type { StableError } from "~/types/error";
import { applyOpenPreview, applyPinTab } from "../lib/preview-tabs";

export type FileTab = {
  path: string;
  name: string;
  /** VS Code-style preview tab: reused by the next preview open until pinned. */
  preview: boolean;
};

export type PathOpResult = { ok: true } | { ok: false; error: StableError };

type LoadState = "loading" | "ready" | "error";

type FileTabsState = {
  tabs: FileTab[];
  activeId: string | null;
  contents: Record<string, string>;
  baselines: Record<string, string>;
  mtimes: Record<string, number>;
  loadState: Record<string, LoadState>;
  errors: Record<string, string | null>;
  readOnly: Record<string, boolean>;
  truncated: Record<string, boolean>;
  externalChanged: Record<string, boolean>;
  reloadTokens: Record<string, number>;
};

export function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

export function joinFsPath(parentAbs: string, name: string): string {
  const sep = parentAbs.includes("\\") ? "\\" : "/";
  const suffix = parentAbs.endsWith("/") || parentAbs.endsWith("\\") ? "" : sep;
  return `${parentAbs}${suffix}${name}`;
}

export type FileTabsModel = ReturnType<typeof createFileTabsModel>;

export function createFileTabsModel(options: {
  projectId: string;
  onError: (error: StableError) => void;
}) {
  const [state, setState] = createStore<FileTabsState>({
    tabs: [],
    activeId: null,
    contents: {},
    baselines: {},
    mtimes: {},
    loadState: {},
    errors: {},
    readOnly: {},
    truncated: {},
    externalChanged: {},
    reloadTokens: {},
  });

  const [watcherPaths, setWatcherPaths] = createSignal<string[]>([]);
  const [pendingClose, setPendingClose] = createSignal<string | null>(null);

  const isDirty = (path: string): boolean => {
    const content = state.contents[path];
    const baseline = state.baselines[path];
    return content !== undefined && baseline !== undefined && content !== baseline;
  };

  const hasDirtyTabs = createMemo(() =>
    state.tabs.some((tab) => {
      const content = state.contents[tab.path];
      const baseline = state.baselines[tab.path];
      return content !== undefined && baseline !== undefined && content !== baseline;
    }),
  );

  const strip = <T>(record: Record<string, T>, path: string): Record<string, T> => {
    if (!(path in record)) return record;
    const next = { ...record };
    delete next[path];
    return next;
  };

  const resetPath = (path: string) => {
    setState((prev) => ({
      contents: strip(prev.contents, path),
      baselines: strip(prev.baselines, path),
      mtimes: strip(prev.mtimes, path),
      loadState: strip(prev.loadState, path),
      errors: strip(prev.errors, path),
      readOnly: strip(prev.readOnly, path),
      truncated: strip(prev.truncated, path),
      externalChanged: strip(prev.externalChanged, path),
      reloadTokens: strip(prev.reloadTokens, path),
    }));
  };

  const remapPath = (from: string, to: string) => {
    const remap = <T>(record: Record<string, T>): Record<string, T> => {
      if (!(from in record)) return record;
      const next = { ...record };
      const value = next[from]!;
      delete next[from];
      next[to] = value;
      return next;
    };
    setState((prev) => ({
      contents: remap(prev.contents),
      baselines: remap(prev.baselines),
      mtimes: remap(prev.mtimes),
      loadState: remap(prev.loadState),
      errors: remap(prev.errors),
      readOnly: remap(prev.readOnly),
      truncated: remap(prev.truncated),
      externalChanged: remap(prev.externalChanged),
      reloadTokens: remap(prev.reloadTokens),
    }));
    setState("tabs", (tabs) =>
      tabs.map((tab) => (tab.path === from ? { ...tab, path: to, name: fileNameOf(to) } : tab)),
    );
    if (state.activeId === from) setState("activeId", to);
  };

  async function load(path: string) {
    setState("loadState", path, "loading");
    setState("errors", path, null);
    const result = await readTextFile(options.projectId, path);
    if (result.isErr()) {
      const error = result.error;
      // Binary or unreadable content: keep the tab but render the read-only
      // preview instead of an editor.
      if (error.code === "INVALID_PATH") {
        setState("readOnly", path, true);
        setState("loadState", path, "ready");
        return;
      }
      setState("loadState", path, "error");
      setState("errors", path, error.message);
      options.onError(error);
      return;
    }
    const file = result.value;
    setState("contents", path, file.text);
    setState("baselines", path, file.text);
    setState("mtimes", path, file.mtimeMs);
    setState("readOnly", path, file.truncated);
    setState("truncated", path, file.truncated);
    setState("externalChanged", path, false);
    setState("loadState", path, "ready");
  }

  /**
   * Open a file. Pinned by default (explicit opens: deep links, new files);
   * pass `{ preview: true }` for single-click navigation, which reuses the
   * clean preview slot. Opening an existing preview without the flag pins it.
   */
  async function openFile(path: string, opts?: { preview?: boolean }) {
    const existing = state.tabs.find((tab) => tab.path === path);
    if (existing) {
      if (existing.preview && !opts?.preview) {
        setState("tabs", (tabs) => applyPinTab(tabs, path));
      }
      setState("activeId", path);
      return;
    }
    if (opts?.preview) {
      const next = applyOpenPreview(state.tabs, state.activeId, path, fileNameOf(path), (p) =>
        isDirty(p),
      );
      setState("tabs", next.tabs);
      setState("activeId", next.activeId);
    } else {
      setState("tabs", (tabs) => [...tabs, { path, name: fileNameOf(path), preview: false }]);
      setState("activeId", path);
    }
    setWatcherPaths(state.tabs.map((tab) => tab.path));
    await load(path);
  }

  /** Single-click navigation: open as a reusable preview tab. */
  async function openPreview(path: string) {
    await openFile(path, { preview: true });
  }

  /** Double-click (or explicit keep): make a preview tab permanent. */
  function pinTab(path: string) {
    setState("tabs", (tabs) => applyPinTab(tabs, path));
  }

  function setActive(path: string) {
    if (state.tabs.some((tab) => tab.path === path)) setState("activeId", path);
  }

  function setContent(path: string, text: string) {
    const wasDirty = isDirty(path);
    setState("contents", path, text);
    // Editing pins a preview tab: once touched, it stays.
    if (!wasDirty && isDirty(path)) {
      setState("tabs", (tabs) => applyPinTab(tabs, path));
    }
  }

  async function save(path: string): Promise<boolean> {
    if (state.readOnly[path]) return false;
    const content = state.contents[path];
    if (content === undefined) return false;
    const result = await writeTextFile(options.projectId, path, content);
    if (result.isErr()) {
      options.onError(result.error);
      return false;
    }
    setState("baselines", path, content);
    setState("mtimes", path, result.value.mtimeMs);
    setState("externalChanged", path, false);
    return true;
  }

  async function saveAll(): Promise<number> {
    let saved = 0;
    for (const tab of state.tabs) {
      if (isDirty(tab.path) && !state.readOnly[tab.path]) {
        if (await save(tab.path)) saved += 1;
      }
    }
    return saved;
  }

  function closeTab(path: string) {
    const index = state.tabs.findIndex((tab) => tab.path === path);
    if (index < 0) return;
    const remaining = state.tabs.filter((tab) => tab.path !== path);
    setState("tabs", remaining);
    resetPath(path);
    if (state.activeId === path) {
      const next = remaining[Math.min(index, remaining.length - 1)];
      setState("activeId", next ? next.path : null);
    }
    setWatcherPaths(remaining.map((tab) => tab.path));
  }

  function closeAll() {
    for (const tab of state.tabs) resetPath(tab.path);
    setState("tabs", []);
    setState("activeId", null);
    setWatcherPaths([]);
  }

  /** Close with an unsaved-changes stop: dirty tabs park in `pendingClose`. */
  function requestClose(path: string) {
    if (isDirty(path)) {
      setPendingClose(path);
    } else {
      closeTab(path);
    }
  }

  function cancelClose() {
    setPendingClose(null);
  }

  function discardAndClose() {
    const path = pendingClose();
    setPendingClose(null);
    if (path) closeTab(path);
  }

  async function saveAndClose() {
    const path = pendingClose();
    setPendingClose(null);
    if (!path) return;
    if (await save(path)) closeTab(path);
  }

  /** Re-read a file from disk and force the editor to adopt the new text. */
  async function reload(path: string) {
    await load(path);
    setState("reloadTokens", path, (state.reloadTokens[path] ?? 0) + 1);
  }

  function dismissExternal(path: string) {
    setState("externalChanged", path, false);
  }

  /** Called by the backend watcher. Own saves are filtered by mtime. */
  function handleExternalChange(path: string, mtimeMs: number) {
    if (!state.tabs.some((tab) => tab.path === path)) return;
    if (state.mtimes[path] === mtimeMs) return;
    if (mtimeMs === 0) {
      setState("externalChanged", path, true);
      return;
    }
    if (isDirty(path)) {
      setState("externalChanged", path, true);
    } else {
      void reload(path);
    }
  }

  async function createFile(dirPath: string, name: string): Promise<PathOpResult> {
    const path = joinFsPath(dirPath, name);
    const result = await createProjectFile(options.projectId, path);
    if (result.isErr()) {
      options.onError(result.error);
      return { ok: false, error: result.error };
    }
    await openFile(path);
    return { ok: true };
  }

  async function createFolder(dirPath: string, name: string): Promise<PathOpResult> {
    const path = joinFsPath(dirPath, name);
    const result = await createProjectFolder(options.projectId, path);
    if (result.isErr()) {
      options.onError(result.error);
      return { ok: false, error: result.error };
    }
    return { ok: true };
  }

  async function renamePath(from: string, to: string): Promise<PathOpResult> {
    const result = await renameProjectPath(options.projectId, from, to);
    if (result.isErr()) {
      options.onError(result.error);
      return { ok: false, error: result.error };
    }
    const affected = state.tabs.filter(
      (tab) =>
        tab.path === from || tab.path.startsWith(`${from}/`) || tab.path.startsWith(`${from}\\`),
    );
    for (const tab of affected) {
      remapPath(tab.path, to + tab.path.slice(from.length));
    }
    setWatcherPaths(state.tabs.map((tab) => tab.path));
    return { ok: true };
  }

  async function deletePath(path: string): Promise<PathOpResult> {
    const result = await deleteProjectPath(options.projectId, path);
    if (result.isErr()) {
      options.onError(result.error);
      return { ok: false, error: result.error };
    }
    for (const tab of state.tabs.slice()) {
      if (
        tab.path === path ||
        tab.path.startsWith(`${path}/`) ||
        tab.path.startsWith(`${path}\\`)
      ) {
        closeTab(tab.path);
      }
    }
    return { ok: true };
  }

  /** Attach the backend watcher to the current tab set. Returns an unlisten. */
  function initWatcher(): () => void {
    let unlisten: (() => void) | undefined;
    void listen<{ path: string; mtimeMs: number }>("file:external-changed", (event) => {
      handleExternalChange(event.payload.path, event.payload.mtimeMs);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }

  const activeTab = createMemo(() => state.tabs.find((tab) => tab.path === state.activeId) ?? null);

  return {
    state,
    activeTab,
    watcherPaths,
    pendingClose,
    hasDirtyTabs,
    isDirty,
    openFile,
    openPreview,
    pinTab,
    requestClose,
    cancelClose,
    discardAndClose,
    saveAndClose,
    setActive,
    setContent,
    save,
    saveAll,
    closeTab,
    closeAll,
    reload,
    dismissExternal,
    handleExternalChange,
    createFile,
    createFolder,
    renamePath,
    deletePath,
    initWatcher,
  };
}
