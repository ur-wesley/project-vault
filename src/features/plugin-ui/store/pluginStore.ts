import type { PluginStoreChangedEvent } from "../types";

// ─── Framework-agnostic per-plugin reactive store mirror ────────────────────
// The Rust backend (`PluginStoreState`) is the source of truth; this class is
// the frontend mirror fed by `plugin:store-changed` events. Pure logic lives
// here so vitest covers it without Tauri. The Solid wrapper below subscribes
// components to key changes.

export type StoreListener = (event: PluginStoreChangedEvent) => void;

export class PluginStoreMirror {
  private values = new Map<string, { value: unknown; version: number }>();
  private listeners = new Set<StoreListener>();

  private mapKey(pluginId: string, key: string): string {
    return `${pluginId}:${key}`;
  }

  applyEvent(event: PluginStoreChangedEvent): void {
    const k = this.mapKey(event.pluginId, event.key);
    if (event.removed) {
      this.values.delete(k);
    } else {
      const cur = this.values.get(k);
      if (cur && cur.version > event.version) return; // drop stale
      this.values.set(k, { value: event.value, version: event.version });
    }
    for (const l of this.listeners) l(event);
  }

  get(pluginId: string, key: string): unknown {
    return this.values.get(this.mapKey(pluginId, key))?.value;
  }

  getVersion(pluginId: string, key: string): number {
    return this.values.get(this.mapKey(pluginId, key))?.version ?? 0;
  }

  has(pluginId: string, key: string): boolean {
    return this.values.has(this.mapKey(pluginId, key));
  }

  keys(pluginId: string): string[] {
    const prefix = `${pluginId}:`;
    const out: string[] = [];
    for (const k of this.values.keys()) {
      if (k.startsWith(prefix)) out.push(k.slice(prefix.length));
    }
    return out.sort();
  }

  clearPlugin(pluginId: string): void {
    const prefix = `${pluginId}:`;
    for (const k of this.values.keys()) {
      if (k.startsWith(prefix)) this.values.delete(k);
    }
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** Singleton mirror fed by the Tauri event bridge. */
export const pluginStoreMirror = new PluginStoreMirror();

/**
 * Parse a plugin-driven poll interval (ms) from a store-mirror value.
 * Returns `fallback` for missing/non-numeric input, otherwise the value
 * rounded and clamped to [minMs, maxMs]. Pure so vitest covers it.
 */
export function parsePollIntervalMs(
  value: unknown,
  fallback = 1000,
  minMs = 500,
  maxMs = 60000,
): number {
  // Missing or clearly non-numeric input means "no preference" — fall back
  // instead of coercing (Number(null) and Number("") are both 0).
  if (value == null || value === "" || typeof value === "boolean") {
    return fallback;
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(maxMs, Math.max(minMs, Math.round(n)));
}
