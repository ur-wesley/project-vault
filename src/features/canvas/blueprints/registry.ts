import type { ProjectDto } from "~/types/dto";
import type { BlueprintDefinition } from "./types";

export interface ScopeDetector {
  id: string;
  /** Higher score wins; 0 = no match. */
  score: (project: ProjectDto) => number;
}

const blueprintDefs = new Map<string, BlueprintDefinition>();
const detectors: ScopeDetector[] = [];

export function defineBlueprint(bp: BlueprintDefinition): BlueprintDefinition {
  blueprintDefs.set(bp.id, bp);
  return bp;
}

export function defineDetector(det: ScopeDetector): ScopeDetector {
  detectors.push(det);
  return det;
}

export function listBlueprintDefs(): BlueprintDefinition[] {
  return [...blueprintDefs.values()];
}

export function listDetectors(): ScopeDetector[] {
  return [...detectors];
}

export function clearBlueprintRegistry(): void {
  blueprintDefs.clear();
  detectors.length = 0;
}
