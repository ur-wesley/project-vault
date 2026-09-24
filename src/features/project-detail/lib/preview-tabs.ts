/**
 * Pure VS Code-style preview-tab transitions. These functions know nothing
 * about reactivity or IO, so they are unit-tested in isolation; the tab model
 * is a thin reactive shell around them.
 *
 * Rules:
 * - Single-click opens activate a preview tab (italic). The next preview
 *   reuses the existing clean preview slot instead of piling up tabs.
 * - A dirty preview is never replaced — the new file opens beside it.
 * - Double-click (or editing the file) pins the tab: it becomes permanent.
 */

export type PreviewTabState = {
  path: string;
  name: string;
  preview: boolean;
};

export type PreviewOpenResult = {
  tabs: PreviewTabState[];
  activeId: string;
};

/**
 * Open `path` as a preview tab. `isPreviewDirty` is injected so this stays
 * pure — the model passes its dirty check, tests pass a lookup.
 */
export function applyOpenPreview(
  tabs: readonly PreviewTabState[],
  activeId: string | null,
  path: string,
  name: string,
  isPreviewDirty: (path: string) => boolean,
): PreviewOpenResult {
  const existing = tabs.findIndex((tab) => tab.path === path);
  // Already open: keep every tab reference stable so Solid's `<For>` (which
  // reconciles rows by reference) reuses all rows instead of remounting
  // every editor. Only the array itself is copied.
  if (existing >= 0) return { tabs: [...tabs], activeId: path };

  const reusable = tabs.findIndex((tab) => tab.preview && !isPreviewDirty(tab.path));
  const next: PreviewTabState = { path, name, preview: true };
  if (reusable >= 0) {
    const list = [...tabs];
    list[reusable] = next;
    return { tabs: list, activeId: path };
  }

  const anchor = activeId ? tabs.findIndex((tab) => tab.path === activeId) : -1;
  const list = [...tabs];
  list.splice(anchor >= 0 ? anchor + 1 : list.length, 0, next);
  return { tabs: list, activeId: path };
}

/** Pin a preview tab so it survives the next preview open. */
export function applyPinTab(tabs: readonly PreviewTabState[], path: string): PreviewTabState[] {
  const index = tabs.findIndex((tab) => tab.path === path);
  if (index < 0 || !tabs[index]!.preview) return [...tabs];
  // Clone only the pinned tab; untouched tabs keep their reference so
  // mounted editors (and their undo history) survive the pin.
  return tabs.map((tab) => (tab.path === path ? { ...tab, preview: false } : tab));
}
