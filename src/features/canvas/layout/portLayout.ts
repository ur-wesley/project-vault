import type { RenderGeometry } from "../geometry/measuredSizes";
import type { NodePorts, PortDecl } from "../state/portSchemas";

export interface PositionedPort {
  id: string;
  label: string;
  schema: string;
  side: "input" | "output";
  x: number;
  y: number;
}

/** Measured-header fallback: matches the real header (~33-37px) so the
 *  default port origin stays byte-identical to the legacy PAD_TOP = 46. */
export const FALLBACK_HEADER_H = 34;
/** Gap between the header bottom edge and the first port row. */
export const PORT_BODY_PAD = 12;
export const PORT_ROW_H = 24;

/**
 * Named dataflow ports: inputs stacked on the left edge, outputs on the
 * right edge, below the node header. Single source of truth for both
 * port-dot rendering and wire endpoint geometry.
 *
 * `headerHeight` is the measured header box (see MeasuredSizes context);
 * defaults to FALLBACK_HEADER_H so unmeasured nodes keep the legacy
 * origin (34 + 12 = 46px below the node top).
 */
export function layoutDataPorts(
  geom: RenderGeometry,
  ports: NodePorts,
  headerHeight: number = FALLBACK_HEADER_H,
): { inputs: PositionedPort[]; outputs: PositionedPort[] } {
  const top = geom.y + headerHeight + PORT_BODY_PAD;
  const place = (decl: PortDecl, side: "input" | "output", index: number): PositionedPort => ({
    id: decl.id,
    label: decl.label,
    schema: decl.schema,
    side,
    x: side === "input" ? geom.x : geom.x + geom.width,
    y: top + index * PORT_ROW_H,
  });
  return {
    inputs: ports.inputs.map((d, i) => place(d, "input", i)),
    outputs: ports.outputs.map((d, i) => place(d, "output", i)),
  };
}
