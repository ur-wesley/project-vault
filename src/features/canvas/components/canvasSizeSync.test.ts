// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import h from "solid-js/h";
import { render } from "solid-js/web";
import type { CanvasNodeDto, CanvasWireDto } from "~/types/dto";
import { defineNode } from "../nodes/registry";
import { MeasuredSizesProvider } from "../geometry/measuredSizes";
import { CanvasNodeContainer } from "./nodes/CanvasNodeContainer";
import { CanvasPortsOverlay } from "./CanvasPortsOverlay";
import { CanvasWiresOverlay } from "./CanvasWiresOverlay";

/** Controllable ResizeObserver stand-in: records observed elements so tests
 *  can drive size reports deterministically (happy-dom has no layout). */
class FakeRO {
  static instances: FakeRO[] = [];
  els = new Set<Element>();
  constructor(private cb: ResizeObserverCallback) {
    FakeRO.instances.push(this);
  }
  observe(el: Element) {
    this.els.add(el);
  }
  unobserve(el: Element) {
    this.els.delete(el);
  }
  disconnect() {
    this.els.clear();
  }
  fire() {
    this.cb([], this as unknown as ResizeObserver);
  }
}

function setBox(el: Element, w: number, h: number) {
  Object.defineProperty(el, "offsetWidth", { configurable: true, value: w });
  Object.defineProperty(el, "offsetHeight", { configurable: true, value: h });
}

/** Fire every observer watching `el` (root box + header each observe). */
function fireFor(el: Element) {
  for (const inst of FakeRO.instances) {
    if (inst.els.has(el)) inst.fire();
  }
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

defineNode({
  type: "sync-plain",
  title: "Plain",
  icon: "mdi--star",
  defaultSize: { width: 300, height: 220 },
  component: (() => null) as never,
});

defineNode({
  type: "sync-probed",
  title: "Probed",
  icon: "mdi--star",
  defaultSize: { width: 300, height: 220 },
  ports: {
    inputs: [{ id: "in", label: "In", schema: "text/plain" }],
    outputs: [{ id: "out", label: "Out", schema: "text/plain" }],
  },
  component: (() => null) as never,
});

const mkNode = (
  id: string,
  nodeType: "sync-plain" | "sync-probed",
  x: number,
  y: number,
): CanvasNodeDto => ({
  id,
  nodeType,
  title: id,
  x,
  y,
  width: 300,
  height: 220,
});

function dotPos(root: HTMLElement, nodeId: string, kind: string, index = 0) {
  const dots = [...root.querySelectorAll(`[data-node-id="${nodeId}"][data-port-kind="${kind}"]`)];
  const wrap = dots[index]?.parentElement;
  if (!wrap) return null;
  return { left: wrap.style.left, top: wrap.style.top, count: dots.length };
}

describe("canvas size sync (loading -> ready growth)", () => {
  let host: HTMLDivElement;
  let dispose: (() => void) | undefined;

  const nodes: CanvasNodeDto[] = [
    mkNode("a", "sync-plain", 100, 50),
    mkNode("b", "sync-plain", 600, 300),
    mkNode("d", "sync-probed", 100, 600),
  ];
  const wires: CanvasWireDto[] = [{ id: "w1", sourceId: "a", targetId: "b" }];

  beforeEach(async () => {
    FakeRO.instances.length = 0;
    dispose?.();
    host = document.createElement("div");
    document.body.appendChild(host);
    vi.stubGlobal("ResizeObserver", FakeRO);
    const raf = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    (window as unknown as Record<string, unknown>).requestAnimationFrame = raf;

    dispose = render(
      () =>
        h(MeasuredSizesProvider, {}, [
          h(CanvasNodeContainer, { node: nodes[0]!, children: h("div", "body-a") }),
          h(CanvasNodeContainer, { node: nodes[1]!, children: h("div", "body-b") }),
          h(CanvasNodeContainer, { node: nodes[2]!, children: h("div", "body-d") }),
          h(CanvasPortsOverlay, { nodes, cursorWorld: { x: 400, y: 400 } }),
          h(CanvasWiresOverlay, { wires, nodes }),
        ]) as unknown as Element,
      host,
    );
    await tick();
  });

  it("moves edge dots + wire endpoints when a node grows (dokploy ready)", async () => {
    const rootA = host.querySelector('[data-canvas-node-id="a"]')!;
    // Loading state: small box.
    setBox(rootA, 300, 90);
    fireFor(rootA);
    await tick();
    expect(dotPos(host, "a", "edge", 0)).not.toBeNull();

    // Ready state: tall content. E/W dots must sit at the new vertical middle.
    setBox(rootA, 300, 420);
    fireFor(rootA);
    await tick();

    const west = [...host.querySelectorAll('[data-node-id="a"][data-port-kind="edge"]')]
      .map((d) => d.parentElement!.style)
      .find((s) => s.left === "100px");
    expect(west?.top).toBe("260px");
  });

  it("keeps wire sides when the target grows (no endpoint migration)", async () => {
    const rootB = host.querySelector('[data-canvas-node-id="b"]')!;
    const rootA = host.querySelector('[data-canvas-node-id="a"]')!;
    setBox(rootA, 300, 220);
    fireFor(rootA);
    // Loading state: short box -> E->W wire.
    setBox(rootB, 300, 90);
    fireFor(rootB);
    await tick();

    const pathOf = () => host.querySelector("svg path[stroke-width]")?.getAttribute("d") ?? "";
    expect(pathOf().startsWith("M 400,160")).toBe(true);
    expect(pathOf().endsWith("600,345")).toBe(true);

    // Ready state: tall content. Endpoints must ride the same sides
    // (E->W) instead of migrating to another pair.
    setBox(rootB, 300, 500);
    fireFor(rootB);
    await tick();
    expect(pathOf().startsWith("M 400,160")).toBe(true);
    expect(pathOf().endsWith("600,550")).toBe(true);
  });

  it("anchors data ports to the measured header, not a magic offset", async () => {
    const rootD = host.querySelector('[data-canvas-node-id="d"]')!;
    const headerD = rootD.querySelectorAll("div")[0]!;
    setBox(rootD, 300, 220);
    setBox(headerD, 300, 36);
    fireFor(rootD);
    fireFor(headerD);
    await tick();

    // 600 (node y) + 36 (measured header) + 12 (body pad).
    expect(dotPos(host, "d", "data", 0)?.top).toBe("648px");

    // Header grows (badge wraps): rows follow it.
    setBox(headerD, 300, 60);
    fireFor(headerD);
    await tick();
    expect(dotPos(host, "d", "data", 0)?.top).toBe("672px");
  });

  it("hides named data ports on minimized (header-only) nodes, keeps edge dots", async () => {
    const rootD = host.querySelector('[data-canvas-node-id="d"]')!;
    const headerD = rootD.querySelectorAll("div")[0]!;
    const rootA = host.querySelector('[data-canvas-node-id="a"]')!;
    setBox(headerD, 300, 36);
    fireFor(headerD);
    // Collapsed to header-only height.
    setBox(rootD, 240, 40);
    fireFor(rootD);
    setBox(rootA, 240, 40);
    fireFor(rootA);
    await tick();

    expect(host.querySelectorAll('[data-node-id="d"][data-port-kind="data"]').length).toBe(0);
    expect(host.querySelectorAll('[data-node-id="a"][data-port-kind="edge"]').length).toBe(4);
  });
});
