import type { CanvasNodeDto, CanvasWireDto, ProjectDto } from "~/types/dto";

/** Node types removed in favor of live-data nodes (see GithubActionsNode, DokployNode). */
export const RETIRED_NODE_TYPES: readonly string[] = ["ci", "deploy", "docker"];

/**
 * Strip retired static nodes (ci/deploy/docker) and any wires touching them
 * from a persisted layout. Idempotent — clean layouts pass through unchanged.
 */
export function migrateCanvasLayout(
  nodes: readonly CanvasNodeDto[],
  wires: readonly CanvasWireDto[],
): { nodes: CanvasNodeDto[]; wires: CanvasWireDto[]; migrated: boolean } {
  const doomed = new Set(
    nodes.filter((n) => RETIRED_NODE_TYPES.includes(n.nodeType)).map((n) => n.id),
  );
  if (doomed.size === 0) {
    return { nodes: [...nodes], wires: [...wires], migrated: false };
  }
  return {
    nodes: nodes.filter((n) => !doomed.has(n.id)),
    wires: wires.filter((w) => !doomed.has(w.sourceId) && !doomed.has(w.targetId)),
    migrated: true,
  };
}

export function hasActionsTag(project: ProjectDto): boolean {
  return project.tags?.includes("github-actions") ?? false;
}

export function hasDeployTag(project: ProjectDto): boolean {
  const tags = project.tags ?? [];
  return tags.includes("dokploy") || tags.includes("docker") || tags.includes("compose");
}

/**
 * Live integration nodes for a project, appended after blueprint defaults.
 * Only returns nodes backed by real detection tags — never placeholders.
 * Fixed ids so re-applying a blueprint replaces instead of duplicating.
 */
export function integrationNodesForProject(project: ProjectDto): {
  nodes: CanvasNodeDto[];
  wires: CanvasWireDto[];
} {
  const nodes: CanvasNodeDto[] = [];
  const wires: CanvasWireDto[] = [];

  if (hasActionsTag(project)) {
    nodes.push({
      id: "node-github-actions",
      nodeType: "github-actions",
      title: "GitHub Actions",
      x: 780,
      y: 80,
      width: 300,
      height: 260,
    });
  }

  if (hasDeployTag(project)) {
    nodes.push({
      id: "node-dokploy",
      nodeType: "dokploy",
      title: "Dokploy",
      x: 780,
      y: hasActionsTag(project) ? 370 : 80,
      width: 300,
      height: 220,
    });
  }

  if (hasActionsTag(project) && hasDeployTag(project)) {
    wires.push({
      id: "wire-actions-dokploy",
      sourceId: "node-github-actions",
      targetId: "node-dokploy",
      wireType: "deployment",
      status: "nominal",
      annotation: "CI ships to Dokploy",
    });
  }

  return { nodes, wires };
}
