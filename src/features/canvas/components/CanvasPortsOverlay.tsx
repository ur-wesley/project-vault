import { For, Show, type Component } from "solid-js";
import type { CanvasNodeDto } from "~/types/dto";
import { getWirePorts, type WireSide } from "../layout/wireGeometry";
import { FALLBACK_HEADER_H, layoutDataPorts, type PositionedPort } from "../layout/portLayout";
import {
  isCollapsedGeometry,
  resolveRenderGeometry,
  useMeasuredSizes,
} from "../geometry/measuredSizes";
import { getNodePorts } from "../state/dataflow";
import { schemasCompatible } from "../state/portSchemas";
import { cn } from "~/lib/utils";

export type DragPort =
  | { kind: "edge"; side: WireSide }
  | { kind: "data"; portId: string; dir: "in" | "out" };

export interface ActiveDrag {
  sourceId: string;
  /** Null when the drag started from a generic edge dot (visual mode). */
  sourcePortId: string | null;
  mode: "data" | "visual";
}

export interface CanvasPortsOverlayProps {
  nodes: CanvasNodeDto[];
  /** Hovered or focused node id — its ports render at full opacity. */
  activeId?: string | null;
  /** Node a drag-to-connect started from — its ports stay highlighted. */
  pendingSourceId?: string | null;
  /** Live drag state for compatibility highlighting. */
  drag?: ActiveDrag | null;
  /** Cursor in world coords; null hides proximity ports. */
  cursorWorld?: { x: number; y: number } | null;
  onPortPointerDown?: (sourceId: string, port: DragPort, e: PointerEvent) => void;
}

const FADE_IN = 90;
const FADE_OUT = 230;

/** 1 near the cursor → 0 past FADE_OUT. Null cursor = hidden. */
function proximityOpacity(
  cursor: { x: number; y: number } | null | undefined,
  x: number,
  y: number,
): number {
  if (!cursor) return 0;
  const dx = cursor.x - x;
  const dy = cursor.y - y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= FADE_IN) return 1;
  if (d >= FADE_OUT) return 0;
  return 1 - (d - FADE_IN) / (FADE_OUT - FADE_IN);
}

/**
 * Connection ports as one overlay layer (no node prop drilling).
 * Nodes with declared dataflow ports show named in/out dots on the
 * left/right edges; all other nodes keep the generic N/E/S/W dots.
 * Dots fade in by cursor proximity, stay lit for the active node,
 * and highlight schema-compatible inputs during data drags.
 */
export const CanvasPortsOverlay: Component<CanvasPortsOverlayProps> = (props) => {
  const measured = useMeasuredSizes();

  const sourceOutSchema = () => {
    const drag = props.drag;
    if (!drag || drag.mode !== "data" || !drag.sourcePortId) return null;
    const node = props.nodes.find((n) => n.id === drag.sourceId);
    if (!node) return null;
    return getNodePorts(node.nodeType)?.outputs.find((p) => p.id === drag.sourcePortId) ?? null;
  };

  return (
    <div
      data-canvas-ports="true"
      class="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      style={{ "z-index": 35 }}
    >
      <For each={props.nodes}>
        {(node) => {
          const decl = () => getNodePorts(node.nodeType);
          const geom = () => resolveRenderGeometry(node, measured.sizes);
          const headerH = () => measured.headerHeights[node.id] ?? FALLBACK_HEADER_H;
          // Minimized nodes hide named data ports (header-only box); edge
          // dots keep working so visual wires can still connect.
          const collapsed = () => isCollapsedGeometry(geom(), headerH());
          const dataPorts = (): { inputs: PositionedPort[]; outputs: PositionedPort[] } => {
            const d = decl();
            if (!d || collapsed()) return { inputs: [], outputs: [] };
            return layoutDataPorts(geom(), d, headerH());
          };
          const edgePorts = () =>
            decl() ? [] : getWirePorts({ ...node, width: geom().width, height: geom().height });
          const isActive = () => props.activeId === node.id || props.pendingSourceId === node.id;

          const inputCompatible = (portId: string) => {
            const schema = sourceOutSchema();
            if (!schema) return false;
            const d = decl();
            const input = d?.inputs.find((p) => p.id === portId);
            if (!input) return false;
            return schemasCompatible(schema, input);
          };

          const dot = (
            x: () => number,
            y: () => number,
            port: DragPort,
            opts: {
              dataPort?: PositionedPort | undefined;
              compat?: () => boolean;
              title: string;
            },
          ) => {
            const opacity = () => {
              if (props.drag?.mode === "data") {
                if (props.drag.sourceId === node.id) return 1;
                if (opts.compat) return opts.compat() ? 1 : 0.25;
                return 0.35;
              }
              if (isActive()) return 1;
              return proximityOpacity(props.cursorWorld, x(), y());
            };
            const interactive = () => opacity() > 0.05;
            return (
              <div
                class="pointer-events-none absolute"
                style={{ left: `${x()}px`, top: `${y()}px` }}
              >
                <div
                  data-node-id={node.id}
                  data-port-kind={port.kind}
                  data-port-id={port.kind === "data" ? port.portId : port.side}
                  data-port-dir={port.kind === "data" ? port.dir : ""}
                  role="button"
                  aria-label={opts.title}
                  title={opts.title}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    props.onPortPointerDown?.(node.id, port, e);
                  }}
                  class={cn(
                    "flex size-5 -translate-x-1/2 -translate-y-1/2 cursor-crosshair items-center justify-center rounded-full transition-opacity duration-150",
                    interactive() ? "pointer-events-auto" : "pointer-events-none",
                  )}
                  style={{ opacity: opacity() }}
                >
                  <span
                    class={cn(
                      "block size-2.5 rounded-full border-2 transition-all",
                      opts.dataPort
                        ? "border-violet-400 bg-violet-500 shadow-[0_0_8px_2px] shadow-violet-500/50"
                        : "border-muted-foreground/70 bg-card hover:border-primary hover:bg-primary",
                      opts.compat?.() &&
                        "border-emerald-400 bg-emerald-500 shadow-[0_0_8px_2px] shadow-emerald-500/50",
                    )}
                  />
                  <Show when={opts.dataPort && (isActive() || opts.compat?.())}>
                    <span
                      class={cn(
                        "absolute whitespace-nowrap rounded border px-1 py-px text-[9px] font-medium",
                        port.kind === "data" && port.dir === "in"
                          ? "left-5 border-border/60 bg-card text-muted-foreground"
                          : "right-5 border-violet-500/40 bg-card text-violet-300",
                      )}
                    >
                      {opts.dataPort!.label}
                    </span>
                  </Show>
                </div>
              </div>
            );
          };

          return (
            <>
              <For each={dataPorts().inputs}>
                {(p) =>
                  dot(
                    () => p.x,
                    () => p.y,
                    { kind: "data", portId: p.id, dir: "in" },
                    {
                      dataPort: p,
                      compat: () => inputCompatible(p.id),
                      title: `${p.label} input (${p.schema}) — drop to connect data`,
                    },
                  )
                }
              </For>
              <For each={dataPorts().outputs}>
                {(p) =>
                  dot(
                    () => p.x,
                    () => p.y,
                    { kind: "data", portId: p.id, dir: "out" },
                    {
                      dataPort: p,
                      title: `${p.label} output (${p.schema}) — drag to connect data`,
                    },
                  )
                }
              </For>
              <For each={edgePorts()}>
                {(port) =>
                  dot(
                    () => port.x,
                    () => port.y,
                    { kind: "edge", side: port.side },
                    {
                      title: "Drag to connect (visual link)",
                    },
                  )
                }
              </For>
            </>
          );
        }}
      </For>
    </div>
  );
};
