import type { CanvasBlueprintDto, CanvasProjectLayoutDto } from "~/types/dto";
import { tauriInvoke } from "./utils";

export function getCanvasLayout(projectId: string) {
  return tauriInvoke<CanvasProjectLayoutDto | null>("get_canvas_layout", {
    projectId,
  });
}

export function saveCanvasLayout(layout: CanvasProjectLayoutDto) {
  return tauriInvoke<void>("save_canvas_layout", { layout });
}

export function listCanvasBlueprints() {
  return tauriInvoke<CanvasBlueprintDto[]>("list_canvas_blueprints");
}

export function saveCanvasBlueprint(blueprint: CanvasBlueprintDto) {
  return tauriInvoke<void>("save_canvas_blueprint", { blueprint });
}

export function deleteCanvasBlueprint(blueprintId: string) {
  return tauriInvoke<void>("delete_canvas_blueprint", { blueprintId });
}

export interface WebPreviewPingDto {
  url: string;
  status: number;
  ok: boolean;
  durationMs: number;
}

export function webPreviewPing(url: string) {
  return tauriInvoke<WebPreviewPingDto>("web_preview_ping", { url });
}
