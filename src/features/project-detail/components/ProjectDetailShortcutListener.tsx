import { createEffect, onCleanup, type Accessor, type Component } from "solid-js";

import { PROJECT_DETAIL_TABS } from "~/lib/app-url";
import { useEventHub } from "~/lib/event-hub-context";

type ProjectDetailShortcutListenerProps = Readonly<{
  detailTab: Accessor<string>;
  onDetailTabChange: (tab: string) => void;
}>;

export const ProjectDetailShortcutListener: Component<ProjectDetailShortcutListenerProps> = (
  props,
) => {
  const hub = useEventHub();

  createEffect(() => {
    const unsub = hub.on("shortcut:action", ({ action }) => {
      const tabMatch = action.match(/^project-tab:(\d+)$/);
      if (tabMatch) {
        const index = parseInt(tabMatch[1]!, 10) - 1;
        if (index >= 0 && index < PROJECT_DETAIL_TABS.length) {
          props.onDetailTabChange(PROJECT_DETAIL_TABS[index]!);
        }
        return;
      }

      if (action === "project-tab:next" || action === "project-tab:prev") {
        const current = props.detailTab();
        const idx = PROJECT_DETAIL_TABS.findIndex((tab) => tab === current);
        const base = idx >= 0 ? idx : 0;
        const delta = action === "project-tab:next" ? 1 : -1;
        const next =
          (base + delta + PROJECT_DETAIL_TABS.length) % PROJECT_DETAIL_TABS.length;
        props.onDetailTabChange(PROJECT_DETAIL_TABS[next]!);
        return;
      }

      if (action === "project-terminal:focus") {
        props.onDetailTabChange("terminal");
        window.setTimeout(() => hub.emit("terminal:focus"), 0);
      }
    });
    onCleanup(unsub);
  });

  return null;
};
