import { For, Show, createMemo, type Component } from "solid-js";
import type { CanvasNodeDto, CanvasWireDto } from "~/types/dto";
import { resolveRenderGeometry, useMeasuredSizes } from "../geometry/measuredSizes";
import { cn } from "~/lib/utils";

const MINIMAP_WIDTH = 188;
const MINIMAP_HEIGHT = 124;
const MIN_WORLD_SPAN = 400;

interface MinimapNodeStyle {
  icon: string;
  fill: string;
  stroke: string;
}

const NODE_MINIMAP_STYLE: Record<string, MinimapNodeStyle> = {
  terminal: {
    icon: "mdi--console",
    fill: "rgba(16,185,129,0.55)",
    stroke: "rgba(16,185,129,0.95)",
  },
  filePreview: {
    icon: "mdi--file-code-outline",
    fill: "rgba(56,189,248,0.55)",
    stroke: "rgba(56,189,248,0.95)",
  },
  webPreview: { icon: "mdi--web", fill: "rgba(34,211,238,0.55)", stroke: "rgba(34,211,238,0.95)" },
  webTools: {
    icon: "mdi--tools",
    fill: "rgba(167,139,250,0.55)",
    stroke: "rgba(167,139,250,0.95)",
  },
  task: {
    icon: "mdi--play-circle-outline",
    fill: "rgba(251,191,36,0.55)",
    stroke: "rgba(251,191,36,0.95)",
  },
  git: { icon: "mdi--git", fill: "rgba(251,146,60,0.55)", stroke: "rgba(251,146,60,0.95)" },
  "github-actions": {
    icon: "mdi--github",
    fill: "rgba(52,211,153,0.55)",
    stroke: "rgba(52,211,153,0.95)",
  },
  dokploy: {
    icon: "mdi--cloud-upload-outline",
    fill: "rgba(129,140,248,0.55)",
    stroke: "rgba(129,140,248,0.95)",
  },
  notes: {
    icon: "mdi--notebook-outline",
    fill: "rgba(148,163,184,0.5)",
    stroke: "rgba(148,163,184,0.95)",
  },
  zettel: {
    icon: "mdi--card-text-outline",
    fill: "rgba(253,224,71,0.5)",
    stroke: "rgba(253,224,71,0.95)",
  },
};

const DEFAULT_MINIMAP_STYLE: MinimapNodeStyle = {
  icon: "mdi--notebook-outline",
  fill: "rgba(148,163,184,0.5)",
  stroke: "rgba(148,163,184,0.95)",
};

const nodeStyle = (nodeType: string): MinimapNodeStyle =>
  NODE_MINIMAP_STYLE[nodeType] ?? DEFAULT_MINIMAP_STYLE;

interface CanvasMinimapProps {
  nodes: CanvasNodeDto[];
  wires: CanvasWireDto[];
  panX: number;
  panY: number;
  zoom: number;
  containerWidth: number;
  containerHeight: number;
  onNavigate: (worldX: number, worldY: number) => void;
  onCenter: () => void;
}

export const CanvasMinimap: Component<CanvasMinimapProps> = (props) => {
  const measured = useMeasuredSizes();

  const bounds = createMemo(() => {
    if (props.nodes.length === 0) {
      return { minX: -200, minY: -150, maxX: 200, maxY: 150 };
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of props.nodes) {
      const g = resolveRenderGeometry(n, measured.sizes);
      minX = Math.min(minX, g.x);
      minY = Math.min(minY, g.y);
      maxX = Math.max(maxX, g.x + g.width);
      maxY = Math.max(maxY, g.y + g.height);
    }
    // Include current viewport center so the viewport rect stays visible
    // even when panned far from all nodes.
    const zoom = props.zoom || 1;
    const centerWorldX = (props.containerWidth / 2 - props.panX) / zoom;
    const centerWorldY = (props.containerHeight / 2 - props.panY) / zoom;
    minX = Math.min(minX, centerWorldX);
    minY = Math.min(minY, centerWorldY);
    maxX = Math.max(maxX, centerWorldX);
    maxY = Math.max(maxY, centerWorldY);

    if (maxX - minX < MIN_WORLD_SPAN) {
      const mid = (minX + maxX) / 2;
      minX = mid - MIN_WORLD_SPAN / 2;
      maxX = mid + MIN_WORLD_SPAN / 2;
    }
    if (maxY - minY < MIN_WORLD_SPAN) {
      const mid = (minY + maxY) / 2;
      minY = mid - MIN_WORLD_SPAN / 2;
      maxY = mid + MIN_WORLD_SPAN / 2;
    }
    return { minX, minY, maxX, maxY };
  });

  // Scale + centering offset so content sits in the middle of the
  // fixed-size map instead of sticking to the top-left corner.
  const layout = createMemo(() => {
    const b = bounds();
    const s = Math.min(MINIMAP_WIDTH / (b.maxX - b.minX), MINIMAP_HEIGHT / (b.maxY - b.minY));
    return {
      bounds: b,
      scale: s,
      offsetX: (MINIMAP_WIDTH - (b.maxX - b.minX) * s) / 2,
      offsetY: (MINIMAP_HEIGHT - (b.maxY - b.minY) * s) / 2,
    };
  });

  const scale = () => layout().scale;

  const toMinimap = (worldX: number, worldY: number) => {
    const l = layout();
    return {
      x: l.offsetX + (worldX - l.bounds.minX) * l.scale,
      y: l.offsetY + (worldY - l.bounds.minY) * l.scale,
    };
  };

  const nodeCenter = (node: CanvasNodeDto) => {
    const g = resolveRenderGeometry(node, measured.sizes);
    return { x: g.x + g.width / 2, y: g.y + g.height / 2 };
  };

  const wireLines = createMemo(() => {
    const byId = new Map(props.nodes.map((n) => [n.id, n]));
    const lines: { x1: number; y1: number; x2: number; y2: number; key: string }[] = [];
    for (const wire of props.wires) {
      const source = byId.get(wire.sourceId);
      const target = byId.get(wire.targetId);
      if (!source || !target) continue;
      const s = toMinimap(nodeCenter(source).x, nodeCenter(source).y);
      const t = toMinimap(nodeCenter(target).x, nodeCenter(target).y);
      lines.push({ x1: s.x, y1: s.y, x2: t.x, y2: t.y, key: wire.id });
    }
    return lines;
  });

  const viewportRect = createMemo(() => {
    const zoom = props.zoom || 1;
    const worldLeft = -props.panX / zoom;
    const worldTop = -props.panY / zoom;
    const worldW = props.containerWidth / zoom;
    const worldH = props.containerHeight / zoom;
    const topLeft = toMinimap(worldLeft, worldTop);
    const s = scale();
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: Math.max(worldW * s, 4),
      height: Math.max(worldH * s, 4),
    };
  });

  let navigating = false;
  // eslint-disable-next-line no-unassigned-vars -- Solid ref pattern
  let mapRef: HTMLDivElement | undefined;

  const navigateFromEvent = (e: PointerEvent) => {
    if (!mapRef) return;
    const rect = mapRef.getBoundingClientRect();
    const rectScaleX = MINIMAP_WIDTH / rect.width;
    const rectScaleY = MINIMAP_HEIGHT / rect.height;
    const mapX = (e.clientX - rect.left) * rectScaleX;
    const mapY = (e.clientY - rect.top) * rectScaleY;
    const l = layout();
    const worldX = l.bounds.minX + (mapX - l.offsetX) / l.scale;
    const worldY = l.bounds.minY + (mapY - l.offsetY) / l.scale;
    props.onNavigate(worldX, worldY);
  };

  const handlePointerDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    navigating = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    navigateFromEvent(e);
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!navigating) return;
    navigateFromEvent(e);
  };

  const handlePointerUp = () => {
    navigating = false;
  };

  return (
    <div class="pointer-events-auto w-[212px] select-none rounded-xl border border-border/40 bg-card/85 shadow-lg backdrop-blur-md">
      {/* Header: label + center button */}
      <div class="flex items-center justify-between px-2.5 pb-1 pt-2">
        <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Minimap
        </span>
        <button
          type="button"
          onClick={props.onCenter}
          class="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Center all nodes into view"
        >
          <span class="iconify mdi--fit-to-page-outline size-3.5" />
        </button>
      </div>

      {/* Map body */}
      <div class="px-2.5 pb-2.5">
        <Show
          when={props.nodes.length > 0}
          fallback={
            <div class="flex h-[124px] w-[188px] items-center justify-center rounded-lg bg-muted/30 text-[11px] text-muted-foreground">
              Empty canvas
            </div>
          }
        >
          <div
            ref={mapRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            class="relative h-[124px] w-[188px] cursor-crosshair overflow-hidden rounded-lg bg-muted/30"
            title="Click to navigate"
          >
            {/* Wire lines */}
            <svg
              class="pointer-events-none absolute inset-0"
              width={MINIMAP_WIDTH}
              height={MINIMAP_HEIGHT}
            >
              <For each={wireLines()}>
                {(line) => (
                  <line
                    x1={line.x1}
                    y1={line.y1}
                    x2={line.x2}
                    y2={line.y2}
                    stroke="rgba(148,163,184,0.55)"
                    stroke-width="1"
                  />
                )}
              </For>
            </svg>

            {/* Node rects */}
            <For each={props.nodes}>
              {(node) => {
                const geom = () => resolveRenderGeometry(node, measured.sizes);
                const pos = () => toMinimap(geom().x, geom().y);
                const s = () => scale();
                const w = () => Math.max(geom().width * s(), 3);
                const h = () => Math.max(geom().height * s(), 3);
                const style = () => nodeStyle(node.nodeType);
                return (
                  <div
                    class="absolute flex items-center justify-center overflow-hidden rounded-[2px] border"
                    title={node.title}
                    style={{
                      left: `${pos().x}px`,
                      top: `${pos().y}px`,
                      width: `${w()}px`,
                      height: `${h()}px`,
                      "background-color": style().fill,
                      "border-color": style().stroke,
                    }}
                  >
                    <Show when={w() >= 16 && h() >= 14}>
                      <span
                        class={cn("iconify shrink-0 text-white/90", style().icon)}
                        style={{ width: "10px", height: "10px" }}
                      />
                    </Show>
                  </div>
                );
              }}
            </For>

            {/* Viewport rect */}
            <div
              class="pointer-events-none absolute rounded-[3px] border border-primary shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
              style={{
                left: `${viewportRect().x}px`,
                top: `${viewportRect().y}px`,
                width: `${viewportRect().width}px`,
                height: `${viewportRect().height}px`,
              }}
            />
          </div>
        </Show>
      </div>
    </div>
  );
};
