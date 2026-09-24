import { describe, expect, it } from "vitest";
import {
  applyViewPatch,
  ConfirmOptionsSchema,
  findRowCommand,
  parseViewSpec,
  StoreChangedEventSchema,
  TableViewSchema,
  ToastOptionsSchema,
  parseTableView,
  scopedStoreKey,
} from "./types";

describe("plugin-ui view types", () => {
  it("accepts a valid table view", () => {
    const view = parseTableView({
      kind: "table",
      columns: [{ id: "name", header: "Repo" }],
      rows: [{ id: "r1", cells: { name: "vault" } }],
      searchable: true,
      pageSize: 20,
      rowCommand: "open_item",
    });
    expect(view.columns).toHaveLength(1);
    expect(view.rows).toHaveLength(1);
  });

  it("rejects empty columns and oversized rows", () => {
    expect(() => TableViewSchema.parse({ kind: "table", columns: [], rows: [] })).toThrow();
    expect(() =>
      TableViewSchema.parse({
        kind: "table",
        columns: [{ id: "a", header: "A" }],
        rows: Array.from({ length: 5001 }, (_, i) => ({
          id: `r${i}`,
          cells: {},
        })),
      }),
    ).toThrow();
  });

  it("rejects duplicate-ish invalid columns", () => {
    expect(() =>
      TableViewSchema.parse({
        kind: "table",
        columns: [{ id: "", header: "empty id" }],
        rows: [],
      }),
    ).toThrow();
  });

  it("validates confirm and toast options", () => {
    expect(() => ConfirmOptionsSchema.parse({ title: "Sure?", danger: true })).not.toThrow();
    expect(() => ConfirmOptionsSchema.parse({ title: "" })).toThrow();
    expect(() => ToastOptionsSchema.parse({ title: "hi", severity: "success" })).not.toThrow();
    expect(() => ToastOptionsSchema.parse({ title: "hi", severity: "nope" })).toThrow();
  });

  it("parses stack/stats/list/markdown view specs", () => {
    expect(
      parseViewSpec({
        kind: "stack",
        children: [
          { kind: "stats", items: [{ id: "dirty", label: "Dirty", value: "3" }] },
          { kind: "markdown", content: "All clean" },
        ],
      }).kind,
    ).toBe("stack");
    expect(parseViewSpec({ kind: "stats", items: [{ id: "a", label: "A", value: 1 }] }).kind).toBe(
      "stats",
    );
    expect(parseViewSpec({ kind: "list", items: [{ id: "a", label: "A" }] }).kind).toBe("list");
    expect(() => parseViewSpec({ kind: "kanban" })).toThrow();
    expect(() => parseViewSpec({ kind: "table", columns: [], rows: [] })).toThrow();
    expect(() =>
      parseViewSpec({
        kind: "stack",
        children: Array.from({ length: 33 }, () => ({ kind: "markdown" })),
      }),
    ).toThrow();
  });

  it("accepts table layout/maxHeight and scroll views", () => {
    const fill = parseTableView({
      kind: "table",
      columns: [{ id: "name", header: "Repo" }],
      rows: [],
      layout: "fill",
      maxHeight: 480,
    });
    expect(fill.layout).toBe("fill");
    expect(() =>
      TableViewSchema.parse({
        kind: "table",
        columns: [{ id: "a", header: "A" }],
        rows: [],
        layout: "sideways",
      }),
    ).toThrow();
    expect(() =>
      TableViewSchema.parse({
        kind: "table",
        columns: [{ id: "a", header: "A" }],
        rows: [],
        maxHeight: 10000,
      }),
    ).toThrow();
    expect(
      parseViewSpec({
        kind: "scroll",
        children: [{ kind: "markdown", content: "hi" }],
        maxHeight: 320,
      }).kind,
    ).toBe("scroll");
    expect(() =>
      parseViewSpec({
        kind: "scroll",
        children: Array.from({ length: 33 }, () => ({ kind: "markdown" })),
      }),
    ).toThrow();
  });

  it("finds row commands through scroll nesting", () => {
    expect(
      findRowCommand({
        kind: "scroll",
        children: [{ kind: "table", rowCommand: "open_deep" }],
      }),
    ).toBe("open_deep");
  });
  it("merges update_view patches without dropping stored view", () => {
    const current = {
      title: "Old",
      view: { kind: "table", rows: [{ id: "r1", cells: {} }] },
    };
    const titled = applyViewPatch(current, { title: "New" });
    expect(titled.title).toBe("New");
    expect(titled.view?.kind).toBe("table");
    const rowsPatched = applyViewPatch(current, {
      rows: [{ id: "r2", cells: {} }],
    });
    const patchedRows = (rowsPatched.view?.rows ?? []) as { id: string }[];
    expect(patchedRows).toHaveLength(1);
    expect(patchedRows[0].id).toBe("r2");
    const viewPatched = applyViewPatch(current, {
      view: { title: "T", rows: [] },
    });
    expect(viewPatched.view?.kind).toBe("table");
    expect((viewPatched.view?.rows ?? []) as unknown[]).toHaveLength(0);
  });

  it("finds row commands through stack and tab nesting", () => {
    expect(findRowCommand({ kind: "table", rowCommand: "open_item" })).toBe("open_item");
    expect(
      findRowCommand({
        kind: "stack",
        children: [{ kind: "stats" }, { kind: "table", rowCommand: "open_repo" }],
      }),
    ).toBe("open_repo");
    expect(findRowCommand({ kind: "stats" })).toBeUndefined();
    expect(findRowCommand(undefined)).toBeUndefined();
  });

  it("validates store-changed events and scopes keys", () => {
    const evt = StoreChangedEventSchema.parse({
      pluginId: "git-hygiene",
      key: "repos/filter",
      value: "dirty",
      version: 2,
    });
    expect(evt.version).toBe(2);
    expect(scopedStoreKey("a", "k")).toBe("a:k");
    expect(scopedStoreKey("a", "k")).not.toBe(scopedStoreKey("b", "k"));
  });
});
