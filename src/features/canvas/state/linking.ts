import type { CanvasNodeDto } from "~/types/dto";
import { parseWebToolsTarget } from "../webview/webToolsBus";

export interface SiblingLinkRule {
  /** Node type of the sibling, e.g. "webTools". */
  siblingType: string;
  /** Extract the target id a sibling points at (null = unlinked). */
  targetOf: (sibling: CanvasNodeDto) => string | null;
  /** Max siblings per target (1 = webTools-style 1:1 rule). */
  maxPerTarget?: number;
}

export const webToolsLinkRule: SiblingLinkRule = {
  siblingType: "webTools",
  targetOf: (n) => parseWebToolsTarget(n.dataJson),
  maxPerTarget: 1,
};

export const DEFAULT_LINK_RULES: SiblingLinkRule[] = [webToolsLinkRule];

/** Generic sibling lookup — replaces linkedToolsId() special-casing. */
export function linkedSiblingId(
  nodes: readonly CanvasNodeDto[],
  targetId: string,
  rule: SiblingLinkRule = webToolsLinkRule,
): string | null {
  for (const n of nodes) {
    if (n.nodeType !== rule.siblingType) continue;
    if (rule.targetOf(n) === targetId) return n.id;
  }
  return null;
}

/** Whether a sibling may claim target under the rule (1:1 enforcement). */
export function canClaimTarget(
  nodes: readonly CanvasNodeDto[],
  siblingId: string,
  targetId: string,
  rule: SiblingLinkRule = webToolsLinkRule,
): boolean {
  if ((rule.maxPerTarget ?? 1) !== 1) return true;
  const claimedBy = linkedSiblingId(nodes, targetId, rule);
  return claimedBy === null || claimedBy === siblingId;
}

/** Cascade ids for siblings pointing at deleted nodes (generic). */
export function collectLinkedDeleteIds(
  nodes: readonly CanvasNodeDto[],
  deletedIds: ReadonlySet<string>,
  rules: readonly SiblingLinkRule[] = DEFAULT_LINK_RULES,
): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (deletedIds.has(n.id)) continue;
    for (const rule of rules) {
      if (n.nodeType !== rule.siblingType) continue;
      const target = rule.targetOf(n);
      if (target !== null && deletedIds.has(target)) {
        out.push(n.id);
        break;
      }
    }
  }
  return out;
}
