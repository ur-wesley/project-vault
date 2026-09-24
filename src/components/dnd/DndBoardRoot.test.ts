// @vitest-environment happy-dom
import h from "solid-js/h";
import { For, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vitest";
import { DndBoardCard, DndBoardColumn } from "./DndBoardItems";
import { DndBoardRoot } from "./DndBoardRoot";
import type { BoardDropEvent } from "./types";

function card(columnId: string, id: string, onOpen: (id: string) => void) {
  return h(
    DndBoardCard,
    { columnId, id },
    (s: {
      setRef: (el: HTMLElement) => void;
      snapshot: () => { isActive: boolean; dx: number; dy: number };
      transition: string;
      dragListeners: { onPointerDown: (e: PointerEvent) => void; onDragStart: (e: Event) => void };
    }) =>
      h(
        "div",
        {
          ref: s.setRef,
          "data-card": id,
          ...s.dragListeners,
        },
        h("span", { "data-handle": id, ...s.dragListeners }, "grip"),
        h("button", { type: "button", "data-open": id, onClick: () => onOpen(id) }, id),
      ),
  );
}

function column(id: string, cards: unknown[]) {
  return h(DndBoardColumn, { id }, (s: { setRef: (el: HTMLElement) => void }) =>
    h("section", { ref: s.setRef, "data-col": id }, cards),
  );
}

function setup() {
  const onOpen = vi.fn();
  const onDrop = vi.fn();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const dispose = render(
    () =>
      h(
        DndBoardRoot,
        {
          onDrop: (e: BoardDropEvent) => onDrop(e),
          overlay: (a: { id: string }) => h("div", { "data-ghost": a.id }, a.id),
        },
        [
          column("todo", [card("todo", "a", onOpen), card("todo", "b", onOpen)]),
          column("doing", [card("doing", "c", onOpen)]),
        ],
      ) as unknown as Element,
    host,
  );
  const rect = (l: number, t: number, r: number, b: number) => () =>
    ({ left: l, top: t, right: r, bottom: b }) as DOMRect;
  (host.querySelector("[data-col='todo']") as HTMLElement).getBoundingClientRect = rect(
    0,
    0,
    200,
    600,
  );
  (host.querySelector("[data-col='doing']") as HTMLElement).getBoundingClientRect = rect(
    210,
    0,
    410,
    600,
  );
  (host.querySelector("[data-card='a']") as HTMLElement).getBoundingClientRect = rect(
    10,
    40,
    190,
    100,
  );
  (host.querySelector("[data-card='b']") as HTMLElement).getBoundingClientRect = rect(
    10,
    110,
    190,
    170,
  );
  (host.querySelector("[data-card='c']") as HTMLElement).getBoundingClientRect = rect(
    220,
    40,
    400,
    100,
  );
  return { onOpen, onDrop, host, dispose };
}

function pointer(target: EventTarget, type: string, x: number, y: number) {
  const e = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
  Object.defineProperty(e, "pointerType", { value: "mouse" });
  target.dispatchEvent(e);
}

function click(target: Element) {
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function keydown(key: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

function textOf(host: Element, columnId: string): string[] {
  const col = host.querySelector(`[data-col='${columnId}']`)!;
  return Array.from(col.querySelectorAll("[data-title]")).map((el) => el.textContent ?? "");
}

describe("DndBoardRoot", () => {
  it("drags a card across columns and reports the drop index", async () => {
    const { onOpen, onDrop, host, dispose } = setup();
    try {
      const handleA = host.querySelector("[data-handle='a']")!;
      pointer(handleA, "pointerdown", 30, 70);
      pointer(window, "pointermove", 90, 70);
      pointer(window, "pointermove", 300, 150);
      await Promise.resolve();
      const ghostOn = document.body.querySelector("[data-ghost]") != null;
      pointer(window, "pointerup", 300, 150);
      expect({ ghostOn, drops: onDrop.mock.calls }).toEqual({
        ghostOn: true,
        drops: [[{ activeId: "a", fromColumn: "todo", toColumn: "doing", toIndex: 1 }]],
      });
      click(host.querySelector("[data-open='a']")!);
      expect(onOpen).not.toHaveBeenCalled();
    } finally {
      dispose();
      host.remove();
    }
  });

  it("plain click opens without dragging", () => {
    const { onOpen, onDrop, host, dispose } = setup();
    try {
      const btn = host.querySelector("[data-open='b']")!;
      pointer(btn, "pointerdown", 30, 140);
      pointer(window, "pointerup", 30, 140);
      click(btn);
      expect(onOpen.mock.calls).toEqual([["b"]]);
      expect(onDrop).not.toHaveBeenCalled();
    } finally {
      dispose();
      host.remove();
    }
  });

  it("Escape cancels the drag", async () => {
    const { onDrop, host, dispose } = setup();
    try {
      const handleA = host.querySelector("[data-handle='a']")!;
      pointer(handleA, "pointerdown", 30, 70);
      pointer(window, "pointermove", 300, 150);
      await Promise.resolve();
      keydown("Escape");
      pointer(window, "pointerup", 300, 150);
      expect(onDrop).not.toHaveBeenCalled();
    } finally {
      dispose();
      host.remove();
    }
  });

  it("a second drag works after the first drop", async () => {
    const { onDrop, host, dispose } = setup();
    try {
      const handleA = host.querySelector("[data-handle='a']")!;
      pointer(handleA, "pointerdown", 30, 70);
      pointer(window, "pointermove", 300, 150);
      await Promise.resolve();
      pointer(window, "pointerup", 300, 150);
      expect(onDrop.mock.calls).toEqual([
        [{ activeId: "a", fromColumn: "todo", toColumn: "doing", toIndex: 1 }],
      ]);
      // Second drag: grab b and drop it in the same column.
      const handleB = host.querySelector("[data-handle='b']")!;
      pointer(handleB, "pointerdown", 30, 140);
      pointer(window, "pointermove", 60, 140);
      pointer(window, "pointermove", 30, 60);
      await Promise.resolve();
      pointer(window, "pointerup", 30, 60);
      expect(onDrop.mock.calls.length).toBe(2);
      expect(onDrop.mock.calls[1]![0]).toMatchObject({ activeId: "b", toColumn: "todo" });
    } finally {
      dispose();
      host.remove();
    }
  });

  it("recovers after a missed pointerup (release off-window)", async () => {
    const { onOpen, onDrop, host, dispose } = setup();
    vi.useFakeTimers();
    try {
      const handleA = host.querySelector("[data-handle='a']")!;
      pointer(handleA, "pointerdown", 30, 70);
      pointer(window, "pointermove", 300, 150);
      await Promise.resolve();
      // No pointerup: window loses focus instead (release outside the app).
      window.dispatchEvent(new FocusEvent("blur"));
      await Promise.resolve();
      expect(onDrop).not.toHaveBeenCalled();
      // Engine recovered: a fresh drag works…
      pointer(handleA, "pointerdown", 30, 70);
      pointer(window, "pointermove", 90, 70);
      pointer(window, "pointermove", 300, 150);
      await Promise.resolve();
      pointer(window, "pointerup", 300, 150);
      expect(onDrop.mock.calls.length).toBe(1);
      // …and clicks work again once the post-drag suppression window lapses.
      vi.advanceTimersByTime(200);
      click(host.querySelector("[data-open='b']")!);
      expect(onOpen.mock.calls).toEqual([["b"]]);
    } finally {
      vi.useRealTimers();
      dispose();
      host.remove();
    }
  });

  it("a throwing onDrop does not brick the engine", async () => {
    const { onDrop, host, dispose } = setup();
    try {
      onDrop.mockImplementationOnce(() => {
        throw new Error("backend down");
      });
      const handleA = host.querySelector("[data-handle='a']")!;
      pointer(handleA, "pointerdown", 30, 70);
      pointer(window, "pointermove", 300, 150);
      await Promise.resolve();
      try {
        pointer(window, "pointerup", 300, 150);
      } catch {
        // Listener exceptions propagate out of dispatchEvent in some DOMs.
      }
      expect(onDrop.mock.calls.length).toBe(1);
      const handleB = host.querySelector("[data-handle='b']")!;
      pointer(handleB, "pointerdown", 30, 140);
      pointer(window, "pointermove", 60, 140);
      pointer(window, "pointermove", 30, 60);
      await Promise.resolve();
      pointer(window, "pointerup", 30, 60);
      expect(onDrop.mock.calls.length).toBe(2);
    } finally {
      dispose();
      host.remove();
    }
  });

  it("faces, grabs and opens track cards across a refetch reorder", async () => {
    // Production shape (KanbanBoard): For + Show per index, no remount key.
    // After a move + query refetch, reused instances must show and act on
    // the CURRENT card, not the one they mounted with.
    vi.useFakeTimers();
    const titles: Record<string, string> = { a: "Alpha", b: "Beta", c: "Gamma" };
    const onOpen = vi.fn();
    const onDrop = vi.fn();
    const [todoIds, setTodoIds] = createSignal(["a", "b"]);
    const [doingIds, setDoingIds] = createSignal(["c"]);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const dispose = render(
      () =>
        h(
          DndBoardRoot,
          {
            onDrop: (e: BoardDropEvent) => onDrop(e),
            overlay: (a: { id: string }) => h("div", { "data-ghost": a.id }, a.id),
          },
          [
            h(DndBoardColumn, { id: "todo" }, (s: { setRef: (el: HTMLElement) => void }) =>
              h(
                "section",
                { ref: s.setRef, "data-col": "todo" },
                h(For, { each: () => todoIds() }, (id: string) =>
                  h(
                    DndBoardCard,
                    { columnId: "todo", id },
                    (cs: {
                      setRef: (el: HTMLElement) => void;
                      dragListeners: {
                        onPointerDown: (e: PointerEvent) => void;
                        onDragStart: (e: Event) => void;
                      };
                    }) =>
                      h(
                        "div",
                        { ref: cs.setRef, "data-card": id, ...cs.dragListeners },
                        h("span", { "data-handle": id, ...cs.dragListeners }, "grip"),
                        h("span", { "data-title": id }, titles[id]),
                        h(
                          "button",
                          { type: "button", "data-open": id, onClick: () => onOpen(id) },
                          id,
                        ),
                      ),
                  ),
                ),
              ),
            ),
            h(DndBoardColumn, { id: "doing" }, (s: { setRef: (el: HTMLElement) => void }) =>
              h(
                "section",
                { ref: s.setRef, "data-col": "doing" },
                h(For, { each: () => doingIds() }, (id: string) =>
                  h(
                    DndBoardCard,
                    { columnId: "doing", id },
                    (cs: {
                      setRef: (el: HTMLElement) => void;
                      dragListeners: {
                        onPointerDown: (e: PointerEvent) => void;
                        onDragStart: (e: Event) => void;
                      };
                    }) =>
                      h(
                        "div",
                        { ref: cs.setRef, "data-card": id, ...cs.dragListeners },
                        h("span", { "data-handle": id, ...cs.dragListeners }, "grip"),
                        h("span", { "data-title": id }, titles[id]),
                        h(
                          "button",
                          { type: "button", "data-open": id, onClick: () => onOpen(id) },
                          id,
                        ),
                      ),
                  ),
                ),
              ),
            ),
          ],
        ) as unknown as Element,
      host,
    );
    try {
      expect(textOf(host, "todo")).toEqual(["Alpha", "Beta"]);
      // Simulate the query refetch after moving "a" todo → doing.
      setTodoIds(["b"]);
      setDoingIds(["a", "c"]);
      await Promise.resolve();
      // Faces must follow the data, not the mount position.
      expect(textOf(host, "todo")).toEqual(["Beta"]);
      expect(textOf(host, "doing")).toEqual(["Alpha", "Gamma"]);
      // Grabbing the visible "Alpha" must grab card "a"…
      const rect = (l: number, t: number, r: number, b: number) => () =>
        ({ left: l, top: t, right: r, bottom: b }) as DOMRect;
      (host.querySelector("[data-col='todo']") as HTMLElement).getBoundingClientRect = rect(
        0,
        0,
        200,
        600,
      );
      (host.querySelector("[data-col='doing']") as HTMLElement).getBoundingClientRect = rect(
        210,
        0,
        410,
        600,
      );
      const doingCards = host.querySelectorAll("[data-col='doing'] [data-card]");
      (doingCards[0] as HTMLElement).getBoundingClientRect = rect(220, 40, 400, 100);
      (doingCards[1] as HTMLElement).getBoundingClientRect = rect(220, 110, 400, 170);
      const alphaHandle = host.querySelector("[data-col='doing'] [data-handle]") as HTMLElement;
      pointer(alphaHandle, "pointerdown", 250, 70);
      pointer(window, "pointermove", 100, 200);
      await Promise.resolve();
      pointer(window, "pointerup", 100, 200);
      expect(onDrop.mock.calls[0]![0]).toMatchObject({ activeId: "a" });
      // …and opening visible "Beta" must open card "b" (past the post-drag
      // click-suppression window, which is by design).
      vi.advanceTimersByTime(200);
      click(host.querySelector("[data-col='todo'] [data-open]")!);
      expect(onOpen.mock.calls).toEqual([["b"]]);
    } finally {
      vi.useRealTimers();
      dispose();
      host.remove();
    }
  });

  it("press without moving fires no drop and keeps clicks working", () => {
    const { onOpen, onDrop, host, dispose } = setup();
    try {
      const handleA = host.querySelector("[data-handle='a']")!;
      pointer(handleA, "pointerdown", 30, 70);
      pointer(window, "pointerup", 30, 70);
      expect(onDrop).not.toHaveBeenCalled();
      click(host.querySelector("[data-open='a']")!);
      expect(onOpen.mock.calls).toEqual([["a"]]);
    } finally {
      dispose();
      host.remove();
    }
  });
});
