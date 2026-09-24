import { BUILTIN_BLUEPRINTS } from "./builtins";
import { detectProjectScope } from "./detector";
import { listDetectors } from "./registry";
import "./detectors";
import type { BlueprintDefinition } from "./types";
import type { ProjectDto } from "~/types/dto";

export * from "./types";
export * from "./builtins";
export * from "./detector";
export * from "./registry";
export * from "./detectors";

// Register builtins once so listBlueprintDefs() mirrors BUILTIN_BLUEPRINTS
// without forcing every consumer to migrate at once.
import { defineBlueprint } from "./registry";
for (const b of BUILTIN_BLUEPRINTS) {
  try {
    defineBlueprint(b);
  } catch {
    // idempotent on HMR
  }
}

export function getRecommendedBlueprint(project: ProjectDto): BlueprintDefinition {
  // Prefer scored detectors when available; fall back to legacy if/else.
  const dets = listDetectors();
  if (dets.length > 0) {
    let best: { id: string; score: number } | null = null;
    for (const d of dets) {
      const s = d.score(project);
      if (!best || s > best.score) best = { id: d.id, score: s };
    }
    const scope = (
      best && best.score > 0 ? best.id : detectProjectScope(project)
    ) as BlueprintDefinition["scope"];
    const match = BUILTIN_BLUEPRINTS.find(
      (b) => b.scope === scope || b.supportedScopes.includes(scope),
    );
    return match ?? BUILTIN_BLUEPRINTS[0]!;
  }
  const scope = detectProjectScope(project);
  const match = BUILTIN_BLUEPRINTS.find(
    (b) => b.scope === scope || b.supportedScopes.includes(scope),
  );
  return match ?? BUILTIN_BLUEPRINTS[0]!;
}
