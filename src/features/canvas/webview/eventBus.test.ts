import { describe, it, expect } from "vitest";
import { createEventBus, createRevBus } from "./eventBus";

describe("createEventBus", () => {
  it("routes keyed + wildcard listeners", () => {
    const bus = createEventBus<{ targetId: string; v: number }>({
      keyOf: (e) => e.targetId,
      wildcardKey: "*",
    });
    const seen: number[] = [];
    const wild: number[] = [];
    bus.subscribeKeyed("a", (e) => seen.push(e.v));
    bus.subscribeKeyed("*", (e) => wild.push(e.v));
    bus.emit({ targetId: "a", v: 1 });
    bus.emit({ targetId: "b", v: 2 });
    expect(seen).toEqual([1]);
    expect(wild).toEqual([1, 2]);
  });
});

describe("createRevBus", () => {
  it("bumps revision and notifies", () => {
    const bus = createRevBus();
    const revs: number[] = [];
    bus.subscribe((r) => revs.push(r));
    bus.notify();
    bus.notify();
    expect(bus.rev()).toBe(2);
    expect(revs).toEqual([1, 2]);
  });
});
