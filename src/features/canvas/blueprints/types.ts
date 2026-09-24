import type { AppScope, CanvasNodeDto, CanvasWireDto, ProjectDto } from "~/types/dto";

export type { AppScope };

export interface BlueprintDefinition {
  id: string;
  name: string;
  description: string;
  scope: AppScope;
  supportedScopes: AppScope[];
  icon: string;
  defaultNodes: CanvasNodeDto[];
  defaultWires: CanvasWireDto[];
  detect?: (project: ProjectDto) => boolean;
}
