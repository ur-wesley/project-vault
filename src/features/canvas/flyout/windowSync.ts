import { listen, emit } from "@tauri-apps/api/event";
import { onCleanup } from "solid-js";

export function broadcastActiveProject(projectId: string) {
  emit("canvas:active_project_changed", { projectId });
}

export function onActiveProjectBroadcast(callback: (projectId: string) => void) {
  let unlisten: (() => void) | undefined;

  listen<{ projectId: string }>("canvas:active_project_changed", (event) => {
    if (event.payload?.projectId) {
      callback(event.payload.projectId);
    }
  }).then((fn) => {
    unlisten = fn;
  });

  onCleanup(() => {
    unlisten?.();
  });
}
