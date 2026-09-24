import type { LocationDto } from "./location";
import type { ProjectDto } from "./project";

export type SettingEntryDto = {
  key: string;
  value: string;
};

export type ExportSnapshotDto = {
  exportedAtMs: number;
  locations: LocationDto[];
  projects: ProjectDto[];
};

export type TemplateSummaryDto = {
  id: string;
  name: string;
  description: string;
  type: "command" | "git" | "files";
  config: Record<string, unknown>;
};

