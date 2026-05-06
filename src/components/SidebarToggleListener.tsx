import { createEffect, onCleanup } from "solid-js";
import { useEventHub } from "~/lib/event-hub-context";
import { useSidebar } from "~/components/ui/sidebar";

export function SidebarToggleListener() {
  const hub = useEventHub();
  const { toggleSidebar } = useSidebar();
  createEffect(() => {
    const listener = hub.on("shortcut:action", (payload) => {
      if (payload.action === "sidebar:toggle") {
        toggleSidebar();
      }
    });
    onCleanup(() => listener());
  });
  return null;
}
