import type { CanvasNodeDto, CanvasWireDto } from "~/types/dto";
import { getNodeDef } from "../nodes/registry";
import { schemasCompatible, type NodePorts, type PortDecl } from "./portSchemas";
import { canConnectManual } from "./manualWires";

export type DataConnectReason = "self" | "duplicate" | "unknown-port" | "schema" | "port-taken";

export type DataConnectVerdict = { ok: true } | { ok: false; reason: DataConnectReason };

export const DATA_CONNECT_MESSAGES: Record<DataConnectReason, string> = {
  self: "A node can't connect to itself.",
  duplicate: "These nodes are already connected.",
  "unknown-port": "That port no longer exists on the node.",
  schema: "Those ports carry incompatible data.",
  "port-taken": "That input already has a connection.",
};

/** Declared ports for a node type, or null when it has none. */
export function getNodePorts(nodeType: string): NodePorts | null {
  return getNodeDef(nodeType)?.ports ?? null;
}

export function findPort(ports: NodePorts | null, id: string | null | undefined): PortDecl | null {
  if (!ports || !id) return null;
  return ports.inputs.find((p) => p.id === id) ?? ports.outputs.find((p) => p.id === id) ?? null;
}

export const isDataWire = (wire: Pick<CanvasWireDto, "kind">): boolean => wire.kind === "data";

/** Whether two live port ids can be bound (exist + schemas compatible). */
export function canBindPorts(
  sourceNodeType: string,
  sourcePortId: string | null | undefined,
  targetNodeType: string,
  targetPortId: string | null | undefined,
  resolvePorts: (nodeType: string) => NodePorts | null = getNodePorts,
): boolean {
  const outPort = resolvePorts(sourceNodeType)?.outputs.find((p) => p.id === sourcePortId) ?? null;
  const inPort = resolvePorts(targetNodeType)?.inputs.find((p) => p.id === targetPortId) ?? null;
  return outPort !== null && inPort !== null && schemasCompatible(outPort, inPort);
}

/**
 * Functional edge rules: base self/dupe checks, then both ports must exist
 * on live declarations, schemas must be compatible, and each input port
 * takes at most one incoming data edge.
 */
export function canConnectData(
  source: { nodeId: string; portId: string },
  target: { nodeId: string; portId: string },
  nodes: readonly CanvasNodeDto[],
  wires: readonly CanvasWireDto[],
  resolvePorts: (nodeType: string) => NodePorts | null = getNodePorts,
): DataConnectVerdict {
  const base = canConnectManual(source.nodeId, target.nodeId, wires);
  if (!base.ok) return base;

  const sourceNode = nodes.find((n) => n.id === source.nodeId);
  const targetNode = nodes.find((n) => n.id === target.nodeId);
  if (!sourceNode || !targetNode) return { ok: false, reason: "unknown-port" };

  const outPort =
    resolvePorts(sourceNode.nodeType)?.outputs.find((p) => p.id === source.portId) ?? null;
  const inPort =
    resolvePorts(targetNode.nodeType)?.inputs.find((p) => p.id === target.portId) ?? null;
  if (!outPort || !inPort) return { ok: false, reason: "unknown-port" };
  if (!schemasCompatible(outPort, inPort)) return { ok: false, reason: "schema" };

  const taken = wires.some(
    (w) => isDataWire(w) && w.targetId === target.nodeId && w.targetPort === target.portId,
  );
  if (taken) return { ok: false, reason: "port-taken" };
  return { ok: true };
}

export type PipelineIssueCode =
  | "cycle"
  | "missing-input"
  | "schema"
  | "unknown-port"
  | "port-taken";

export interface PipelineIssue {
  code: PipelineIssueCode;
  message: string;
  wireId?: string;
  nodeId?: string;
}

/**
 * Pure pipeline validation over data wires. Visual (assoc) wires are
 * exempt. Deterministic — safe to run on every layout change.
 */
export function validatePipeline(
  nodes: readonly CanvasNodeDto[],
  wires: readonly CanvasWireDto[],
  resolvePorts: (nodeType: string) => NodePorts | null = getNodePorts,
): PipelineIssue[] {
  const issues: PipelineIssue[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const dataWires = wires.filter(isDataWire);

  // Per-wire: ports exist on live declarations + schemas still compatible.
  for (const w of dataWires) {
    const s = byId.get(w.sourceId);
    const t = byId.get(w.targetId);
    if (!s || !t) continue; // dangling handled by node-delete cascade
    const outPort = resolvePorts(s.nodeType)?.outputs.find((p) => p.id === w.sourcePort) ?? null;
    const inPort = resolvePorts(t.nodeType)?.inputs.find((p) => p.id === w.targetPort) ?? null;
    if (!outPort || !inPort) {
      issues.push({
        code: "unknown-port",
        message: `Connection "${w.annotation ?? "unlabeled"}" references a removed port.`,
        wireId: w.id,
      });
      continue;
    }
    if (!schemasCompatible(outPort, inPort)) {
      issues.push({
        code: "schema",
        message: `${outPort.schema} can't flow into ${inPort.schema}.`,
        wireId: w.id,
      });
    }
  }

  // Port-taken: more than one data edge into the same input port.
  const seenInputs = new Map<string, CanvasWireDto>();
  for (const w of dataWires) {
    if (!byId.get(w.sourceId) || !byId.get(w.targetId)) continue;
    const key = `${w.targetId}::${w.targetPort ?? ""}`;
    const prev = seenInputs.get(key);
    if (prev) {
      issues.push({
        code: "port-taken",
        message: `Input has more than one incoming connection.`,
        wireId: w.id,
        nodeId: w.targetId,
      });
    } else {
      seenInputs.set(key, w);
    }
  }

  // Required inputs with no incoming data edge.
  for (const n of nodes) {
    const ports = resolvePorts(n.nodeType);
    if (!ports) continue;
    for (const input of ports.inputs) {
      if (!input.required) continue;
      const fed = dataWires.some((w) => w.targetId === n.id && w.targetPort === input.id);
      if (!fed) {
        issues.push({
          code: "missing-input",
          message: `"${n.title}" needs its "${input.label}" input connected.`,
          nodeId: n.id,
        });
      }
    }
  }

  // Cycles over data edges (iterative DFS, reports each back-edge wire).
  const adjacency = new Map<string, CanvasWireDto[]>();
  for (const w of dataWires) {
    if (!byId.get(w.sourceId) || !byId.get(w.targetId)) continue;
    const list = adjacency.get(w.sourceId) ?? [];
    list.push(w);
    adjacency.set(w.sourceId, list);
  }
  const color = new Map<string, "gray" | "black">();
  const visit = (startId: string) => {
    const stack: { id: string; edgeIdx: number }[] = [{ id: startId, edgeIdx: 0 }];
    color.set(startId, "gray");
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const edges = adjacency.get(top.id) ?? [];
      if (top.edgeIdx >= edges.length) {
        color.set(top.id, "black");
        stack.pop();
        continue;
      }
      const edge = edges[top.edgeIdx++];
      const next = edge.targetId;
      const c = color.get(next);
      if (c === "gray") {
        issues.push({
          code: "cycle",
          message: `Connection creates a cycle in the pipeline.`,
          wireId: edge.id,
        });
      } else if (!c) {
        color.set(next, "gray");
        stack.push({ id: next, edgeIdx: 0 });
      }
    }
  };
  for (const n of nodes) {
    if (!color.get(n.id) && adjacency.has(n.id)) visit(n.id);
  }

  return issues;
}
