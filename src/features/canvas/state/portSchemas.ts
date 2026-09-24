/**
 * Typed port schemas for functional (dataflow) connections.
 *
 * Each named port declares one schema; `accepts` widens what an input
 * tolerates (e.g. a notes input takes plain text but also markdown or a
 * task result). `json` is the universal schema — compatible both ways.
 */

export type PortSchema =
  | "trigger"
  | "text/plain"
  | "text/markdown"
  | "file/ref"
  | "task/result"
  | "process/event"
  | "git/status"
  | "json"
  | (string & {});

export interface PortDecl {
  id: string;
  label: string;
  schema: PortSchema;
  /** Extra schemas this input tolerates beyond its own. */
  accepts?: PortSchema[];
  /** Validation reports required inputs with no incoming data edge. */
  required?: boolean;
}

export interface NodePorts {
  inputs: PortDecl[];
  outputs: PortDecl[];
}

export function schemasCompatible(from: PortDecl, to: PortDecl): boolean {
  if (!from || !to) return false;
  if (from.schema === "json" || to.schema === "json") return true;
  if (from.schema === to.schema) return true;
  return (to.accepts ?? []).includes(from.schema);
}
