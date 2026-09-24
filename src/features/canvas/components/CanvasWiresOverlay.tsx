import { For, Show, createMemo, type Component } from "solid-js";
import type { CanvasNodeDto, CanvasWireDto } from "~/types/dto";
import {
  getWirePorts,
  resolveAnchoredGeometry,
  resolveWireGeometry,
  wirePreviewPath,
  type AnchoredGeometry,
  type WireGeometry,
  type WireObstacle,
  type WireSide,
} from "../layout/wireGeometry";
import { layoutDataPorts, FALLBACK_HEADER_H } from "../layout/portLayout";
import {
  isCollapsedGeometry,
  resolveRenderGeometry,
  useMeasuredSizes,
  type MeasuredBox,
} from "../geometry/measuredSizes";
import { getNodePorts, isDataWire } from "../state/dataflow";

function getWireHighlight(status: CanvasWireDto["status"]): string {
  if (status === "red") return "#fee2e2";
  if (status === "amber") return "#fef3c7";
  return "#e0e7ff";
}

export interface WireAnchor {
  clientX: number;
  clientY: number;
}

export interface WirePendingPreview {
  sourceId: string;
  sourceSide?: WireSide;
  /** Set when the drag started from a named data port. */
  sourcePortId?: string | null;
  /** Which end the drag started from (data drags may start at an input). */
  sourceDir?: "in" | "out" | "edge";
  mode: "data" | "visual";
  cursorX: number;
  cursorY: number;
}

/** World position of a named data port, or null when unresolvable
 *  (unknown port, or node minimized — data ports hide when collapsed). */
function dataPortPosition(
  node: CanvasNodeDto,
  sizes: Record<string, MeasuredBox>,
  portId: string | null | undefined,
  dir: "in" | "out",
  headerHeight: number = FALLBACK_HEADER_H,
): { x: number; y: number } | null {
  if (!portId) return null;
  const decl = getNodePorts(node.nodeType);
  if (!decl) return null;
  const geom = resolveRenderGeometry(node, sizes);
  if (isCollapsedGeometry(geom, headerHeight)) return null;
  const laid = layoutDataPorts(geom, decl, headerHeight);
  const list = dir === "in" ? laid.inputs : laid.outputs;
  const found = list.find((p) => p.id === portId);
  return found ? { x: found.x, y: found.y } : null;
}

interface CanvasWiresOverlayProps {
  wires: CanvasWireDto[];
  nodes: CanvasNodeDto[];
  selectedWireId?: string | null;
  pending?: WirePendingPreview | null;
  onWireSelect?: (wireId: string, anchor: WireAnchor) => void;
  onActionClick?: (wire: CanvasWireDto) => void;
}

export const CanvasWiresOverlay: Component<CanvasWiresOverlayProps> = (props) => {
  const measured = useMeasuredSizes();

  // Index once per nodes change: per-wire endpoint lookup is O(1) instead
  // of a linear scan, turning per-frame wire resolution from O(W·N) to O(W).
  const nodeById = createMemo(() => {
    const m = new Map<string, CanvasNodeDto>();
    for (const n of props.nodes) m.set(n.id, n);
    return m;
  });

  const getNode = (id: string): CanvasNodeDto | undefined => {
    return nodeById().get(id);
  };

  // Obstacle boxes for wire routing: every node's rendered box. Each wire
  // filters out its own endpoints; the preview filters out the source node
  // (plus any node containing the cursor — the likely drop target).
  const obstacleRects = createMemo(() => {
    const arr: (WireObstacle & { id: string })[] = [];
    for (const n of props.nodes) {
      const g = resolveRenderGeometry(n, measured.sizes);
      arr.push({ id: n.id, x: g.x, y: g.y, width: g.width, height: g.height });
    }
    return arr;
  });

  // Drag-to-connect preview: fixed source port → live cursor (world coords).
  // Data drags start from the named output port; visual drags from an edge.
  const preview = createMemo(() => {
    const p = props.pending;
    if (!p) return null;
    const source = getNode(p.sourceId);
    if (!source) return null;
    const sg = resolveRenderGeometry(source, measured.sizes);
    let start: { x: number; y: number } | null = null;
    if (p.mode === "data" && p.sourcePortId) {
      start = dataPortPosition(
        source,
        measured.sizes,
        p.sourcePortId,
        "out",
        measured.headerHeights[source.id] ?? FALLBACK_HEADER_H,
      );
    } else {
      const port = getWirePorts({ ...source, width: sg.width, height: sg.height }).find(
        (pt) => pt.side === p.sourceSide,
      );
      if (port) start = { x: port.x, y: port.y };
    }
    if (!start) return null;
    const obstacles = obstacleRects().filter((o) => o.id !== p.sourceId);
    return {
      d: wirePreviewPath(start.x, start.y, p.cursorX, p.cursorY, obstacles),
      cursorX: p.cursorX,
      cursorY: p.cursorY,
    };
  });

  return (
    <svg
      class="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      style={{ "z-index": 1 }}
    >
      <defs>
        <linearGradient id="wire-nominal" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.35" />
          <stop offset="100%" stop-color="#818cf8" stop-opacity="0.5" />
        </linearGradient>
        <linearGradient id="wire-amber" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#fbbf24" stop-opacity="0.9" />
          <stop offset="100%" stop-color="#f59e0b" stop-opacity="1" />
        </linearGradient>
        <linearGradient id="wire-red" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#f87171" stop-opacity="0.9" />
          <stop offset="100%" stop-color="#ef4444" stop-opacity="1" />
        </linearGradient>
        <filter id="glow-amber" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
        <filter id="glow-red" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      <For each={props.wires}>
        {(wire) => {
          // Reactive geometry: <For> only re-runs this callback on list changes,
          // so endpoint math must live in a memo that tracks node positions.
          // The memo feeds its previous sides back as a pin: endpoints ride
          // the box edges on resize instead of migrating between sides
          // (a loader swapping to content must not move the wire).
          const geom = createMemo<WireGeometry | AnchoredGeometry | null>(
            (prev: WireGeometry | AnchoredGeometry | null = null) => {
              const source = getNode(wire.sourceId);
              const target = getNode(wire.targetId);
              if (!source || !target) return null;

              // Data wires anchor to their named ports (outputs face east,
              // inputs face west); visual wires use smart N/E/S/W routing.
              // Re-runs on every x/y/w/h change, so wires follow live drags.
              // Endpoints use rendered sizes so they land on the visible box
              // even when it differs from DTO dimensions (minimized, auto-height).
              if (isDataWire(wire)) {
                const s = dataPortPosition(
                  source,
                  measured.sizes,
                  wire.sourcePort,
                  "out",
                  measured.headerHeights[source.id] ?? FALLBACK_HEADER_H,
                );
                const t = dataPortPosition(
                  target,
                  measured.sizes,
                  wire.targetPort,
                  "in",
                  measured.headerHeights[target.id] ?? FALLBACK_HEADER_H,
                );
                if (s && t) {
                  const obstacles = obstacleRects().filter(
                    (o) => o.id !== wire.sourceId && o.id !== wire.targetId,
                  );
                  return resolveAnchoredGeometry(
                    {
                      x1: s.x,
                      y1: s.y,
                      nx1: 1,
                      ny1: 0,
                      x2: t.x,
                      y2: t.y,
                      nx2: -1,
                      ny2: 0,
                    },
                    obstacles,
                  );
                }
              }
              // Smart routing: shortest of the 16 N/E/S/W port pairs, avoiding
              // third-party nodes. Previous sides pin the choice (sticky) so
              // resizes ride the edges instead of flipping sides.
              const sg = resolveRenderGeometry(source, measured.sizes);
              const tg = resolveRenderGeometry(target, measured.sizes);
              const obstacles = obstacleRects().filter(
                (o) => o.id !== wire.sourceId && o.id !== wire.targetId,
              );
              const stickTo =
                prev && "sourceSide" in prev
                  ? { sourceSide: prev.sourceSide, targetSide: prev.targetSide }
                  : undefined;
              return resolveWireGeometry(
                { ...source, width: sg.width, height: sg.height },
                { ...target, width: tg.width, height: tg.height },
                obstacles,
                stickTo,
              );
            },
            null,
          );

          const isSelected = () => props.selectedWireId === wire.id;

          const strokeColor = () => {
            if (isSelected()) return "#a78bfa";
            if (wire.status === "red") return "url(#wire-red)";
            if (wire.status === "amber") return "url(#wire-amber)";
            return "url(#wire-nominal)";
          };

          const strokeWidth = () => {
            if (isSelected()) return 3.5;
            if (wire.status === "red" || wire.status === "amber") return 3;
            return 2;
          };

          const filter = () => {
            if (wire.status === "red") return "url(#glow-red)";
            if (wire.status === "amber") return "url(#glow-amber)";
            return undefined;
          };

          return (
            <Show when={geom()}>
              {(g) => (
                <g>
                  {/* Geometry updates every frame during drags — no transition
                  here, otherwise wires visibly trail the cursor. */}
                  {/* Wide invisible hit path: click selects the wire. */}
                  <path
                    d={g().pathD}
                    fill="none"
                    stroke="transparent"
                    stroke-width={14}
                    class="pointer-events-auto"
                    style={{ cursor: "pointer" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onWireSelect?.(wire.id, {
                        clientX: e.clientX,
                        clientY: e.clientY,
                      });
                    }}
                  />
                  {/* Background thicker stroke for hit detection / glow */}
                  <path
                    d={g().pathD}
                    fill="none"
                    stroke={strokeColor()}
                    stroke-width={strokeWidth()}
                    filter={filter()}
                    class={wire.status === "red" ? "animate-pulse" : undefined}
                  />

                  {/* Directional flow particle animation */}
                  <path
                    d={g().pathD}
                    fill="none"
                    stroke={getWireHighlight(wire.status)}
                    stroke-width={1.5}
                    stroke-dasharray="6, 12"
                    class="opacity-75"
                    style={{
                      animation: "canvas-wire-dash 2s linear infinite",
                    }}
                  />

                  {/* Annotation Badge & Action Chip */}
                  <Show when={wire.annotation}>
                    <foreignObject
                      x={g().midX - 110}
                      y={g().midY - 16}
                      width={220}
                      height={36}
                      class="pointer-events-auto overflow-visible"
                    >
                      <div class="flex items-center justify-center">
                        <button
                          type="button"
                          onClick={(e) => {
                            props.onWireSelect?.(wire.id, {
                              clientX: e.clientX,
                              clientY: e.clientY,
                            });
                            props.onActionClick?.(wire);
                          }}
                          class="flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-medium shadow-sm transition-all hover:scale-105"
                          classList={{
                            "bg-destructive/95 text-destructive-foreground border-destructive/50":
                              wire.status === "red",
                            "bg-amber-500/95 text-amber-950 border-amber-600/50 dark:text-amber-100":
                              wire.status === "amber",
                            "bg-slate-900/90 text-slate-300 border-slate-700/60 backdrop-blur-sm":
                              !wire.status || wire.status === "nominal",
                          }}
                        >
                          <Show when={wire.status === "red"}>
                            <span class="iconify mdi--alert-circle size-3 text-white" />
                          </Show>
                          <Show when={wire.status === "amber"}>
                            <span class="iconify mdi--alert size-3" />
                          </Show>
                          <span class="truncate max-w-[140px]">{wire.annotation}</span>
                          <Show when={wire.actionLabel}>
                            <span class="ml-1 underline font-semibold">{wire.actionLabel}</span>
                          </Show>
                        </button>
                      </div>
                    </foreignObject>
                  </Show>
                </g>
              )}
            </Show>
          );
        }}
      </For>

      {/* Live drag-to-connect preview */}
      <Show when={preview()}>
        {(pv) => (
          <g class="pointer-events-none">
            <path
              d={pv().d}
              fill="none"
              stroke="#a78bfa"
              stroke-width={2.5}
              stroke-dasharray="8, 6"
              class="opacity-90"
            />
            <circle cx={pv().cursorX} cy={pv().cursorY} r={5} fill="#a78bfa" class="opacity-90" />
          </g>
        )}
      </Show>
    </svg>
  );
};
