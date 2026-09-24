import { onCleanup, onMount } from "solid-js";

export type ScopedKeyMatch = (event: KeyboardEvent) => boolean;

export function ctrlOrMeta(event: KeyboardEvent): boolean {
  return event.ctrlKey || event.metaKey;
}

/** Match a chord like Ctrl/Mod+key without extra modifiers. */
export function chord(key: string, opts?: { shift?: boolean; alt?: boolean }): ScopedKeyMatch {
  const want = key.toLowerCase();
  return (event) => {
    if (!ctrlOrMeta(event)) return false;
    if (!!event.shiftKey !== !!opts?.shift) return false;
    if (!!event.altKey !== !!opts?.alt) return false;
    return event.key.toLowerCase() === want;
  };
}

export type ScopedShortcutOptions = {
  /** Scope subtree the focus must be inside, e.g. "files". */
  scope: string;
  /**
   * Nested scopes that also count as inside (nearest-scope wins by default).
   * Example: the files-tab close shortcut also fires from the editor scope.
   */
  includeNested?: readonly string[];
  match: ScopedKeyMatch;
  handler: (event: KeyboardEvent) => void;
  /** Skip the handler while true (dialogs, recording, …). Defaults to active. */
  enabled?: () => boolean;
};

/**
 * Focus-scoped keyboard shortcut for feature surfaces. Editor text itself
 * stays on the CodeMirror keymap; this covers everything around it (tab
 * strip, tree, toolbar) without touching the global shortcut registry.
 *
 * Runs in capture phase and stops propagation so a matching app-level
 * registry chord never double-fires.
 */
export function useScopedShortcut(options: ScopedShortcutOptions) {
  onMount(() => {
    const listener = (event: KeyboardEvent) => {
      if (options.enabled && !options.enabled()) return;
      const target = event.target as HTMLElement | null;
      const nearest = target?.closest?.("[data-shortcut-scope]") as HTMLElement | null;
      const scopeName = nearest?.dataset.shortcutScope;
      const inside =
        scopeName === options.scope || (options.includeNested?.includes(scopeName ?? "") ?? false);
      if (!inside) return;
      if (!options.match(event)) return;
      event.preventDefault();
      event.stopPropagation();
      options.handler(event);
    };
    window.addEventListener("keydown", listener, { capture: true });
    onCleanup(() => window.removeEventListener("keydown", listener, { capture: true }));
  });
}
