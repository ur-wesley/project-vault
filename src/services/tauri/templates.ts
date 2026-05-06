import type { TemplateSummaryDto, CreateProjectPayload, CreateProjectResultDto, RunTemplateCommandPayload, RunTemplateCommandResultDto } from "~/types/dto";
import { tauriInvoke } from "./utils";

export function listProjectTemplates() {
  return tauriInvoke<TemplateSummaryDto[]>("list_project_templates");
}

export function createProjectFromTemplate(payload: CreateProjectPayload) {
  return tauriInvoke<CreateProjectResultDto>("create_project_from_template", { payload });
}

export function saveProjectTemplates(templatesJson: string) {
  return tauriInvoke<void>("save_project_templates", { templatesJson });
}

export function runTemplateCommand(payload: RunTemplateCommandPayload) {
  return tauriInvoke<RunTemplateCommandResultDto>("run_template_command", { payload });
}
