// @vitest-environment happy-dom
import h from "solid-js/h";
import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vitest";
import { DndSortableItem, type DndSortableItemRenderState } from "./DndSortableItem";
import { DndSortableRoot } from "./DndSortableRoot";
import type { ReorderEvent } from "./types";

function item(id: string, onSelect: (id: string) => void) {
  return h(DndSortableItem, { id }, (s: DndSortableItemRenderState) =>
    h(
      "div",
      {
        ref: s.setRef,
        "data-tab": id,
        style: { transition: s.transition },
        ...s.dragListeners,
      },
      h("button", { type: "button", "data-select": id, onClick: () => onSelect(id) }, id),
    ),
  );
}

function setup() {
  const onSelect = vi.fn();
  const onReorder = vi.fn();
  const overlayCalls: string[] = [];
  const host = document.createElement("div");
  document.body.appendChild(host);
  const dispose = render(
    // h() returns a hyper-element thunk; Solid resolves function children.
    () =>
      h(
        DndSortableRoot,
        // NOTE: h() turns zero-arg function props into getters, so wrap spies.
        {
          ids: ["a", "b"],
          onReorder: (e: ReorderEvent) => onReorder(e),
          orientation: "horizontal" as const,
          overlay: (id: string) => {
            overlayCalls.push(id);
            return h("div", { "data-ghost": id }, id);
          },
        },
        [item("a", onSelect), item("b", onSelect)],
      ) as unknown as Element,
    host,
  );
  return { onSelect, onReorder, overlayCalls, host, dispose };
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

describe("DndSortableRoot click behavior", () => {
  it("plain click selects without starting a drag", () => {
    const { onSelect, onReorder, host, dispose } = setup();
    try {
      const callsAtSetup = onSelect.mock.calls.length;
      const btn = host.querySelector("[data-select='b']")!;
      let nativeClick = 0;
      btn.addEventListener("click", () => nativeClick++);
      pointer(btn, "pointerdown", 100, 10);
      pointer(window, "pointerup", 100, 10);
      const connected = btn.isConnected && host.contains(btn);
      click(btn);
      expect({
        callsAtSetup,
        callsAfterClick: onSelect.mock.calls,
        nativeClick,
        connected,
      }).toEqual({
        callsAtSetup: 0,
        callsAfterClick: [["b"]],
        nativeClick: 1,
        connected: true,
      });
      expect(onReorder).not.toHaveBeenCalled();
    } finally {
      dispose();
      host.remove();
    }
  });

  it("a second drag works after the first drop", async () => {
    const { onReorder, host, dispose } = setup();
    try {
      const tabA = host.querySelector("[data-tab='a']") as HTMLElement;
      const tabB = host.querySelector("[data-tab='b']") as HTMLElement;
      tabA.getBoundingClientRect = () => ({ left: 0, right: 100, top: 0, bottom: 32 }) as DOMRect;
      tabB.getBoundingClientRect = () => ({ left: 102, right: 202, top: 0, bottom: 32 }) as DOMRect;
      pointer(tabA, "pointerdown", 50, 10);
      pointer(window, "pointermove", 160, 10);
      await Promise.resolve();
      pointer(window, "pointerup", 160, 10);
      expect(onReorder.mock.calls).toEqual([[{ activeId: "a", overId: "b" }]]);
      pointer(tabB, "pointerdown", 150, 10);
      pointer(window, "pointermove", 40, 10);
      await Promise.resolve();
      pointer(window, "pointerup", 40, 10);
      expect(onReorder.mock.calls.length).toBe(2);
      expect(onReorder.mock.calls[1]![0]).toEqual({ activeId: "b", overId: "a" });
    } finally {
      dispose();
      host.remove();
    }
  });

  it("recovers after a missed pointerup", async () => {
    const { onReorder, onSelect, host, dispose } = setup();
    try {
      const tabA = host.querySelector("[data-tab='a']") as HTMLElement;
      tabA.getBoundingClientRect = () => ({ left: 0, right: 100, top: 0, bottom: 32 }) as DOMRect;
      pointer(tabA, "pointerdown", 50, 10);
      pointer(window, "pointermove", 90, 10);
      await Promise.resolve();
      // No pointerup: window loses focus instead.
      window.dispatchEvent(new FocusEvent("blur"));
      await Promise.resolve();
      expect(onReorder).not.toHaveBeenCalled();
      pointer(tabA, "pointerdown", 50, 10);
      pointer(window, "pointermove", 90, 10);
      pointer(window, "pointerup", 90, 10);
      // Press without travel: no reorder, click still works.
      expect(onReorder).not.toHaveBeenCalled();
      click(tabA.querySelector("button")!);
      expect(onSelect.mock.calls).toEqual([["a"]]);
    } finally {
      dispose();
      host.remove();
    }
  });

  it("click right after a real drag is swallowed, reorder fires", async () => {
    const { onSelect, onReorder, overlayCalls, host, dispose } = setup();
    try {
      const tabA = host.querySelector("[data-tab='a']") as HTMLElement;
      const tabB = host.querySelector("[data-tab='b']") as HTMLElement;
      let nativePointerDown = 0;
      tabA.addEventListener("pointerdown", () => nativePointerDown++);
      tabA.getBoundingClientRect = () => ({ left: 0, right: 100, top: 0, bottom: 32 }) as DOMRect;
      tabB.getBoundingClientRect = () => ({ left: 102, right: 202, top: 0, bottom: 32 }) as DOMRect;
      pointer(tabA, "pointerdown", 50, 10);
      pointer(window, "pointermove", 90, 10);
      pointer(window, "pointermove", 160, 10);
      await Promise.resolve();
      const userSelect = document.body.style.userSelect;
      const overlayOn = document.body.querySelector("[data-ghost]") != null;
      const bodyHtml = document.body.innerHTML.slice(-600);
      pointer(window, "pointerup", 160, 10);
      expect({
        overlayOn,
        reorderCalls: onReorder.mock.calls,
        nativePointerDown,
        userSelect,
        bodyHtml,
        overlayCalls,
      }).toEqual({
        overlayOn: true,
        reorderCalls: [[{ activeId: "a", overId: "b" }]],
        nativePointerDown: 1,
        userSelect: "none",
        bodyHtml: expect.stringContaining("data-ghost"),
        overlayCalls: ["a"],
      });
      click(tabA.querySelector("button")!);
      expect(onSelect).not.toHaveBeenCalled();
    } finally {
      dispose();
      host.remove();
    }
  });
});
