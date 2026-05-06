import type { MiseToolDto, MiseToolSuggestionDto } from "~/types/dto";
import { tauriInvoke } from "./utils";

export function getProjectMiseTools(projectId: string) {
  return tauriInvoke<MiseToolDto[]>("get_project_mise_tools", { projectId });
}

export function suggestMiseTools(projectId: string) {
  return tauriInvoke<MiseToolSuggestionDto[]>("suggest_mise_tools", { projectId });
}

export function pinMiseTools(projectId: string, tools: MiseToolSuggestionDto[]) {
  return tauriInvoke<void>("pin_mise_tools", { payload: { projectId, tools } });
}
