// @vitest-environment happy-dom
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "~/lib/i18n-context";
import { KanbanBoard } from "./KanbanBoard";
import type { KanbanBoardView, KanbanCardMeta, KanbanStatus } from "./types";

function makeCard(
  id: string,
  title: string,
  status: KanbanStatus,
): KanbanCardMeta & { body: string } {
  return {
    id,
    board: "b1",
    title,
    status,
    priority: "medium",
    tags: [],
    assignees: [],
    parent: null,
    relations: [],
    due: null,
    archived: false,
    links: { tasks: [], files: [], issues: [], workspaces: [] },
    checklist: [],
    body: "",
  };
}

function makeBoard(cards: (KanbanCardMeta & { body: string })[]): KanbanBoardView {
  const order: Record<string, string[]> = { todo: [], doing: [] };
  for (const c of cards) (order[c.status] ??= []).push(c.id);
  return { id: "b1", title: "B1", columns: ["todo", "doing"], order, tagColors: {}, cards };
}

function titlesOf(host: Element, column: string): string[] {
  const col = Array.from(host.querySelectorAll("section")).find(
    (s) => s.querySelector("h3")?.textContent === column,
  )!;
  return Array.from(col.querySelectorAll("article p")).map((el) => el.textContent ?? "");
}

describe("KanbanBoard refetch freshness", () => {
  it("faces, opens and moves track current cards after reorder + edits", async () => {
    const onMove = vi.fn();
    const onOpen = vi.fn();
    const [board, setBoard] = createSignal(
      makeBoard([makeCard("a", "Alpha", "todo"), makeCard("b", "Beta", "todo")]),
    );
    const host = document.createElement("div");
    document.body.appendChild(host);
    const dispose = render(
      () => (
        <I18nProvider>
          <KanbanBoard
            board={board()}
            columns={["todo", "doing"]}
            visibleOrder={{
              todo: board().order.todo ?? [],
              doing: board().order.doing ?? [],
            }}
            sortMode="manual"
            onMove={(id, to, pos) => void onMove(id, to, pos)}
            onCreateCard={() => {}}
            onOpenCard={(id) => void onOpen(id)}
          />
        </I18nProvider>
      ),
      host,
    );
    try {
      expect(titlesOf(host, "todo")).toEqual(["Alpha", "Beta"]);
      // Simulate backend move a→doing + refetch with FRESH card objects.
      setBoard(makeBoard([makeCard("b", "Beta", "todo"), makeCard("a", "Alpha", "doing")]));
      await Promise.resolve();
      expect(titlesOf(host, "todo")).toEqual(["Beta"]);
      expect(titlesOf(host, "doing")).toEqual(["Alpha"]);
      // Same-id data edit (fresh objects, same ids).
      setBoard(makeBoard([makeCard("b", "Beta2", "todo"), makeCard("a", "Alpha", "doing")]));
      await Promise.resolve();
      expect(titlesOf(host, "todo")).toEqual(["Beta2"]);
      // Same-id data edit (fresh objects, same ids).
      setBoard(makeBoard([makeCard("b", "Beta2", "todo"), makeCard("a", "Alpha", "doing")]));
      await Promise.resolve();
      expect(titlesOf(host, "todo")).toEqual(["Beta2"]);
      // Clicking the visible card opens the CURRENT id…
      const todoSection = Array.from(host.querySelectorAll("section")).find(
        (s) => s.querySelector("h3")?.textContent === "todo",
      )!;
      todoSection
        .querySelector("article")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      expect(onOpen.mock.calls).toEqual([["b"]]);
      // …and the arrow moves the CURRENT id.
      const moveBtn = todoSection.querySelector("article button")!;
      moveBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      expect(onMove.mock.calls[0]![0]).toBe("b");
    } finally {
      dispose();
      host.remove();
    }
  });
});
