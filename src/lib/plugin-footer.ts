import { createSignal } from "solid-js";

export type PluginFooterColor = "default" | "success" | "warning" | "error" | "primary" | "muted";

export type PluginFooterSegment = {
  /** Unique key = `${pluginId}:${id}` */
  key: string;
  pluginId: string;
  id: string;
  text: string;
  icon?: string;
  tooltip?: string;
  /** Plugin command id to execute when the segment is clicked */
  command?: string;
  color: PluginFooterColor;
  position?: "left" | "right";
};

// Global store — shared between PluginUiBridge (writes) and StatusBar (reads).
// Using a module-level signal avoids prop drilling through App.tsx.
const [pluginFooterSegments, setPluginFooterSegments] = createSignal<PluginFooterSegment[]>([]);

export { pluginFooterSegments };

export function upsertFooterSegment(segment: Omit<PluginFooterSegment, "key">) {
  const key = `${segment.pluginId}:${segment.id}`;
  setPluginFooterSegments((prev) => {
    const existing = prev.findIndex((s) => s.key === key);
    const next = { ...segment, key };
    if (existing === -1) return [...prev, next];
    const copy = [...prev];
    copy[existing] = next;
    return copy;
  });
}

export function removeFooterSegment(pluginId: string, id: string) {
  const key = `${pluginId}:${id}`;
  setPluginFooterSegments((prev) => prev.filter((s) => s.key !== key));
}

export function clearPluginFooterSegments(pluginId: string) {
  setPluginFooterSegments((prev) => prev.filter((s) => s.pluginId !== pluginId));
}
