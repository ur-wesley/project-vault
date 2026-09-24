import type { IconifyJSON } from "@iconify/types";
import { getIconData } from "@iconify/utils";

import { iconToSvgString, type FileIconData } from "../file-icon";

export const PLUGIN_ICON_PREFIXES = ["mdi", "catppuccin", "devicon-plain"] as const;

export type PluginIconPrefix = (typeof PLUGIN_ICON_PREFIXES)[number];

export type ParsedPluginIcon = {
  prefix: PluginIconPrefix;
  name: string;
};

const collectionCache = new Map<PluginIconPrefix, IconifyJSON | null>();
const collectionPending = new Map<PluginIconPrefix, Promise<IconifyJSON | null>>();
const iconCache = new Map<string, FileIconData | null>();

export function parsePluginIcon(icon: string): ParsedPluginIcon | null {
  const trimmed = icon.trim();
  if (!trimmed) return null;

  const colonIdx = trimmed.indexOf(":");
  if (colonIdx > 0) {
    const prefix = trimmed.slice(0, colonIdx);
    const name = trimmed.slice(colonIdx + 1);
    if (!name || !isPluginIconPrefix(prefix)) return null;
    return { prefix, name };
  }

  const dashIdx = trimmed.indexOf("--");
  if (dashIdx <= 0) return null;
  const prefix = trimmed.slice(0, dashIdx);
  const name = trimmed.slice(dashIdx + 2);
  if (!name || !isPluginIconPrefix(prefix)) return null;
  return { prefix, name };
}

function isPluginIconPrefix(prefix: string): prefix is PluginIconPrefix {
  return (PLUGIN_ICON_PREFIXES as readonly string[]).includes(prefix);
}

async function fetchCollection(prefix: PluginIconPrefix): Promise<IconifyJSON | null> {
  const res = await fetch(`/iconify/${prefix}.json`);
  if (!res.ok) return null;
  return (await res.json()) as IconifyJSON;
}

async function loadCollection(prefix: PluginIconPrefix): Promise<IconifyJSON | null> {
  if (collectionCache.has(prefix)) return collectionCache.get(prefix) ?? null;

  const inFlight = collectionPending.get(prefix);
  if (inFlight) return inFlight;

  const promise = fetchCollection(prefix)
    .then((data) => {
      collectionCache.set(prefix, data);
      return data;
    })
    .finally(() => {
      collectionPending.delete(prefix);
    });

  collectionPending.set(prefix, promise);
  return promise;
}

export function resolvePluginIconData(collection: IconifyJSON, name: string): FileIconData | null {
  const icon = getIconData(collection, name);
  if (!icon) return null;
  return {
    body: icon.body,
    width: icon.width ?? collection.width,
    height: icon.height ?? collection.height,
  };
}

export async function loadPluginIcon(icon: string): Promise<FileIconData | null> {
  const parsed = parsePluginIcon(icon);
  if (!parsed) return null;

  const cacheKey = `${parsed.prefix}:${parsed.name}`;
  if (iconCache.has(cacheKey)) return iconCache.get(cacheKey)!;

  const collection = await loadCollection(parsed.prefix);
  if (!collection) {
    iconCache.set(cacheKey, null);
    return null;
  }

  const data = resolvePluginIconData(collection, parsed.name);
  iconCache.set(cacheKey, data);
  return data;
}

export function pluginIconToSvgString(icon: FileIconData, size = "1em"): string {
  return iconToSvgString(icon, size);
}
