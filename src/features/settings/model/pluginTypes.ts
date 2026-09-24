import { isRecord } from "~/lib/guards";
import type { MonorepoDiscovery } from "../components/MonorepoInstallDialog";

export type { MonorepoDiscovery };

/** i18n function threaded through the dashboard (mirrors `useI18n().t`). */
export type TFunction = (key: string, params?: Record<string, unknown>) => string;

// Resolve a plugin's `locales` map (same shape as command locales in
// CommandPalette/ShortcutsSettingsTab): active locale, en fallback.
export function pluginLocaleMap(
  plugin: { locales?: Record<string, unknown> } | undefined,
  activeLocale: string,
): Record<string, unknown> {
  const m = plugin?.locales;
  if (!isRecord(m)) return {};
  const active = m[activeLocale];
  if (isRecord(active)) return active;
  const en = m.en;
  if (isRecord(en)) return en;
  return {};
}

export function pluginLocaleString(
  plugin: { locales?: Record<string, unknown> } | undefined,
  activeLocale: string,
  key: string,
): string | undefined {
  const v = pluginLocaleMap(plugin, activeLocale)[key];
  return typeof v === "string" ? v : undefined;
}

// Interfaces
export interface PluginCommandMetadata {
  id: string;
  title: string;
  scope: string;
  pluginId: string;
  locales?: Record<string, unknown>;
}

export interface PluginConfigItem {
  key: string;
  label: string;
  description?: string;
  type: string;
  default?: string | boolean | number;
  options?: { id: string; label: string }[];
}

export interface PluginInfo {
  id: string;
  name: string;
  description?: string;
  version?: string;
  category?: string;
  enabled: boolean;
  commands: PluginCommandMetadata[];
  pages?: Array<{
    id: string;
    title: string;
    icon?: string;
    defaultPinned: boolean;
    command?: string;
  }>;
  locales?: Record<string, unknown>;
  options?: { id: string; label: string }[];
  activeOption?: string;
  config?: PluginConfigItem[];
  // Lazy loading additions
  lazy: boolean;
  active: boolean;
  loadTimeMs: number;
  repo?: string;
  dir?: string;
  localPath?: string;
  dependencies: string[];
  externals: string[];
}

export interface DiscoveredPlugin {
  id: string;
  name: string | null;
  description: string | null;
  version: string | null;
  category: string | null;
}

export interface DiscoveredRepo {
  repo: string;
  slug: string;
  entries: DiscoveredPlugin[];
}

export function asPluginOptionList(value: unknown): { id: string; label: string }[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is { id: string; label: string } => {
    if (!isRecord(item)) return false;
    return typeof item.id === "string" && typeof item.label === "string";
  });
}

export function asPluginConfigList(value: unknown): PluginConfigItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is PluginConfigItem => {
    if (!isRecord(item)) return false;
    return (
      typeof item.key === "string" &&
      typeof item.label === "string" &&
      typeof item.type === "string"
    );
  });
}

export function pluginHasSettings(plugin: PluginInfo): boolean {
  return (
    asPluginOptionList(plugin.options).length > 0 || asPluginConfigList(plugin.config).length > 0
  );
}
