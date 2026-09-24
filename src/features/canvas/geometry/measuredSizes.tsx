import { createContext, useContext, type Component, type ParentProps } from "solid-js";
import { createStore } from "solid-js/store";
import type { CanvasNodeDto } from "~/types/dto";

export type MeasuredBox = { width: number; height: number };

/** Single fallback used whenever a node has no DTO or measured size. */
export const DEFAULT_NODE_SIZE: MeasuredBox = { width: 320, height: 220 };

interface MeasuredSizesApi {
  sizes: Record<string, MeasuredBox>;
  reportSize: (id: string, width: number, height: number) => void;
  /** Measured node header heights (px) for port-row anchoring. */
  headerHeights: Record<string, number>;
  reportHeaderHeight: (id: string, height: number) => void;
}

const MeasuredSizesContext = createContext<MeasuredSizesApi>({
  sizes: {},
  reportSize: () => {},
  headerHeights: {},
  reportHeaderHeight: () => {},
});

/**
 * Canvas-scoped store of real rendered node sizes. Persisted DTO dimensions
 * go stale whenever the rendered box differs from them (minimized nodes,
 * auto-height fixed-content nodes, content that outgrows its DTO) — and
 * anything drawing from DTO sizes alone (minimap, wire endpoints) then
 * disagrees with what's on screen. One provider per CanvasView, so flyout
 * and main views never share entries.
 */
export const MeasuredSizesProvider: Component<ParentProps> = (props) => {
  const [sizes, setSizes] = createStore<Record<string, MeasuredBox>>({});
  const [headerHeights, setHeaderHeights] = createStore<Record<string, number>>({});

  const reportSize = (id: string, width: number, height: number) => {
    const w = Math.round(width);
    const h = Math.round(height);
    const prev = sizes[id];
    if (prev && prev.width === w && prev.height === h) return;
    setSizes(id, { width: w, height: h });
    // Mirror into the module snapshot so code outside the provider
    // subtree (auto-layout trigger, fit-view handler) can also frame
    // nodes by their rendered box instead of stale DTO dimensions.
    measuredSnapshot[id] = { width: w, height: h };
  };

  const reportHeaderHeight = (id: string, height: number) => {
    const h = Math.round(height);
    if (headerHeights[id] === h) return;
    setHeaderHeights(id, h);
  };

  return (
    <MeasuredSizesContext.Provider value={{ sizes, reportSize, headerHeights, reportHeaderHeight }}>
      {props.children}
    </MeasuredSizesContext.Provider>
  );
};

export const useMeasuredSizes = () => useContext(MeasuredSizesContext);

/**
 * Module-level mirror of the last reported sizes. The provider store is
 * only readable inside its subtree, but auto-layout and fit-view triggers
 * live outside it — they read this snapshot instead of raw DTO dims.
 * Keyed by node id; entries go stale when nodes are removed (harmless:
 * lookups miss and callers fall back to DTO dimensions).
 */
export const measuredSnapshot: Record<string, MeasuredBox> = {};

export interface RenderGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Geometry as actually rendered: live position from the DTO, size measured
 * from the DOM with DTO dimensions as fallback (e.g. before first measure).
 */
export function resolveRenderGeometry(
  node: Pick<CanvasNodeDto, "id" | "x" | "y" | "width" | "height">,
  sizes: Record<string, MeasuredBox>,
): RenderGeometry {
  const m = sizes[node.id];
  return {
    x: node.x,
    y: node.y,
    width: m?.width ?? node.width ?? DEFAULT_NODE_SIZE.width,
    height: m?.height ?? node.height ?? DEFAULT_NODE_SIZE.height,
  };
}

/**
 * True when the rendered box is header-only tall, i.e. the node is
 * minimized/collapsed. Named dataflow ports hide in this state (decision:
 * hide ports on minimized nodes) while generic edge dots keep working.
 */
export function isCollapsedGeometry(geom: RenderGeometry, headerHeight: number): boolean {
  return geom.height <= headerHeight + 8;
}
