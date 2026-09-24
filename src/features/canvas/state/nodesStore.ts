import { createMemo } from "solid-js";
import { createStore, reconcile, produce } from "solid-js/store";
import type { CanvasNodeDto } from "~/types/dto";
import { getNodeDef } from "../nodes/registry";
import { DEFAULT_NODE_SIZE } from "../geometry/measuredSizes";

export function createNodesStore() {
  const [nodes, setNodes] = createStore<CanvasNodeDto[]>([]);

  const replaceAll = (next: CanvasNodeDto[]) => setNodes(reconcile(next, { key: "id" }));
  // O(1) id lookup: built once per nodes change instead of a linear scan
  // per caller (wires resolve 2 lookups each, per frame during drags).
  const byId = createMemo(() => {
    const m = new Map<string, CanvasNodeDto>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  });
  const find = (id: string) => byId().get(id);

  const upsertPosition = (id: string, x: number, y: number) =>
    setNodes(
      (n) => n.id === id,
      produce((node) => {
        node.x = x;
        node.y = y;
      }),
    );

  const upsertSize = (id: string, width: number, height: number) =>
    setNodes(
      (n) => n.id === id,
      produce((node) => {
        node.width = width;
        node.height = height;
      }),
    );

  const upsertData = (id: string, dataJson: string | null) =>
    setNodes(
      (n) => n.id === id,
      produce((node) => {
        node.dataJson = dataJson;
      }),
    );

  const rename = (id: string, title: string) => {
    const next = title.trim().slice(0, 80);
    if (!next) return;
    const current = find(id);
    if (!current || current.title === next) return;
    setNodes(
      (n) => n.id === id,
      produce((node) => {
        node.title = next;
      }),
    );
  };

  const togglePin = (id: string) =>
    setNodes(
      (n) => n.id === id,
      produce((node) => {
        node.isPinned = !node.isPinned;
      }),
    );

  const removeMany = (ids: ReadonlySet<string>) => setNodes(nodes.filter((n) => !ids.has(n.id)));

  const getDefaultWidth = (type: string, fallback: number) => {
    if (type === "filePreview") return 560;
    if (type === "terminal" || type === "webPreview" || type === "webTools") return 420;
    return fallback;
  };

  const getDefaultHeight = (type: string, fallback: number) => {
    if (type === "filePreview") return 380;
    if (type === "terminal" || type === "webPreview" || type === "webTools") return 300;
    return fallback;
  };

  const addNode = (
    type: string,
    title: string,
    dataJson?: string,
    at?: { x: number; y: number },
  ): CanvasNodeDto => {
    const def = getNodeDef(type);
    const size = def?.defaultSize ?? DEFAULT_NODE_SIZE;
    // Registry-aware defaults replace the if/else width chain.
    const width = getDefaultWidth(type, size.width);
    const height = getDefaultHeight(type, size.height);
    // Timestamp ids collide on fast multi-adds (blueprints, chain
    // inserts) — prefer a UUID with a timestamp fallback.
    let id: string;
    try {
      id =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? `node-${crypto.randomUUID()}`
          : `node-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    } catch {
      id = `node-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    }
    const node: CanvasNodeDto = {
      id,
      nodeType: type,
      title,
      x: at?.x ?? 100 + Math.random() * 200,
      y: at?.y ?? 100 + Math.random() * 200,
      width,
      height,
      dataJson: dataJson ?? def?.defaultDataJson ?? null,
    };
    setNodes(nodes.length, node);
    return node;
  };

  const moveNode = (id: string, x: number, y: number) => {
    const anchor = find(id);
    if (!anchor) return;
    setNodes(
      (n) => n.id === id,
      produce((node) => {
        node.x = x;
        node.y = y;
      }),
    );
  };

  return {
    nodes: () => nodes,
    byId,
    setNodes,
    replaceAll,
    find,
    upsertPosition,
    upsertSize,
    upsertData,
    rename,
    togglePin,
    removeMany,
    addNode,
    moveNode,
  };
}

export type NodesStore = ReturnType<typeof createNodesStore>;
