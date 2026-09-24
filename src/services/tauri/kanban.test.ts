import { describe, expect, it } from "vitest";

import {
  normalizeKanbanBoardSummary,
  normalizeKanbanBoardView,
  type RawKanbanBoardSummary,
  type RawKanbanBoardView,
} from "./kanban";

const boardFixture = (): RawKanbanBoardView => ({
  id: "sprint-12",
  title: "Sprint 12",
  columns: ["todo", "doing", "done"],
  order: { todo: ["c1"], doing: [], done: [] },
  tagColors: undefined as unknown as Record<string, string>,
  cards: [],
});

describe("normalizeKanbanBoardView", () => {
  it("maps snake_case tag_colors from the backend to tagColors", () => {
    const raw = {
      ...boardFixture(),
      tag_colors: { dx: "#fbbf24" },
    } as RawKanbanBoardView;
    const view = normalizeKanbanBoardView(raw);
    expect(view.tagColors).toEqual({ dx: "#fbbf24" });
    // Tag lookup (the KanbanCardView crash) must not throw.
    expect((view.tagColors ?? {})["dx"]).toBe("#fbbf24");
  });

  it("prefers camelCase tagColors when both key styles are present", () => {
    const raw = {
      ...boardFixture(),
      tagColors: { dx: "#111111" },
      tag_colors: { dx: "#222222" },
    } as RawKanbanBoardView;
    expect(normalizeKanbanBoardView(raw).tagColors).toEqual({ dx: "#111111" });
  });

  it("defaults to an empty map when the backend sends neither key", () => {
    const { tag_colors: _dropped, ...raw } = boardFixture();
    const view = normalizeKanbanBoardView(raw);
    expect(view.tagColors).toEqual({});
  });

  it("preserves id, columns, order, and cards", () => {
    const raw = {
      ...boardFixture(),
      tag_colors: {},
    } as RawKanbanBoardView;
    const view = normalizeKanbanBoardView(raw);
    expect(view.id).toBe("sprint-12");
    expect(view.columns).toEqual(["todo", "doing", "done"]);
    expect(view.order).toEqual({ todo: ["c1"], doing: [], done: [] });
  });
});

describe("normalizeKanbanBoardSummary", () => {
  it("maps snake_case card_count from the backend to cardCount", () => {
    const raw = {
      id: "sprint-12",
      title: "Sprint 12",
      columns: [],
      cardCount: undefined as unknown as number,
      card_count: 9,
    } as RawKanbanBoardSummary;
    expect(normalizeKanbanBoardSummary(raw).cardCount).toBe(9);
  });

  it("defaults to 0 when the backend sends neither key", () => {
    const raw = { id: "b", title: "B", columns: [] } as unknown as RawKanbanBoardSummary;
    expect(normalizeKanbanBoardSummary(raw).cardCount).toBe(0);
  });
});
