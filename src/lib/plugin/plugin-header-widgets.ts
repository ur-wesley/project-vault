import { createSignal } from "solid-js";

export type PluginHeaderWidget = {
  /** Unique key = `${pluginId}:${id}` */
  key: string;
  pluginId: string;
  id: string;
  type: "button" | "badge" | "text";
  text: string;
  icon?: string;
  tooltip?: string;
  command?: string;
  color: "default" | "success" | "warning" | "error" | "primary" | "muted";
};

const [pluginHeaderWidgets, setPluginHeaderWidgets] = createSignal<PluginHeaderWidget[]>([]);

export { pluginHeaderWidgets };

export function upsertHeaderWidget(widget: Omit<PluginHeaderWidget, "key">) {
  const key = `${widget.pluginId}:${widget.id}`;
  setPluginHeaderWidgets((prev) => {
    const existing = prev.findIndex((w) => w.key === key);
    const next = { ...widget, key };
    if (existing === -1) return [...prev, next];
    const copy = [...prev];
    copy[existing] = next;
    return copy;
  });
}

export function removeHeaderWidget(pluginId: string, id: string) {
  const key = `${pluginId}:${id}`;
  setPluginHeaderWidgets((prev) => prev.filter((w) => w.key !== key));
}

export function clearPluginHeaderWidgets(pluginId: string) {
  setPluginHeaderWidgets((prev) => prev.filter((w) => w.pluginId !== pluginId));
}

export function clearAllHeaderWidgets() {
  setPluginHeaderWidgets([]);
}
