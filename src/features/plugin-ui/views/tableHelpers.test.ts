import { describe, expect, it } from "vitest";
import { filterRows, getCellActions, getCellText, paginateRows, sortRows } from "./tableHelpers";
import type { PluginTableColumn, PluginTableRow } from "../types";

const cols: PluginTableColumn[] = [
  { id: "name", header: "Repo", sortable: true },
  { id: "status", header: "Status" },
];

const rows: PluginTableRow[] = [
  { id: "r1", cells: { name: "vault", status: "dirty", count: 3 } },
  { id: "r2", cells: { name: "app", status: "clean", count: 10 } },
  { id: "r3", cells: { name: "Zebra", status: "dirty", count: 1 } },
];

describe("tableHelpers", () => {
  it("filters case-insensitively across columns", () => {
    expect(filterRows(rows, cols, "vault")).toHaveLength(1);
    expect(filterRows(rows, cols, "DIRTY")).toHaveLength(2);
    expect(filterRows(rows, cols, "")).toHaveLength(3);
  });

  it("sorts strings and numbers", () => {
    const asc = sortRows(rows, cols, "name", "asc").map((r) => r.id);
    expect(asc).toEqual(["r2", "r1", "r3"]);
    const desc = sortRows(rows, cols, "name", "desc").map((r) => r.id);
    expect(desc).toEqual(["r3", "r1", "r2"]);
    const numCols: PluginTableColumn[] = [{ id: "count", header: "N" }];
    const numRows: PluginTableRow[] = [
      { id: "a", cells: { count: 10 } },
      { id: "b", cells: { count: 2 } },
    ];
    expect(sortRows(numRows, numCols, "count", "asc").map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("leaves rows untouched for unknown/unsortable columns", () => {
    expect(sortRows(rows, cols, "nope", "asc")).toBe(rows);
  });

  it("paginates and clamps", () => {
    const { pageRows, pageCount, page } = paginateRows(rows, 0, 2);
    expect(pageRows).toHaveLength(2);
    expect(pageCount).toBe(2);
    expect(page).toBe(0);
    const last = paginateRows(rows, 99, 2);
    expect(last.page).toBe(1);
    expect(last.pageRows).toHaveLength(1);
  });
});

describe("actions cells", () => {
  const opsCol: PluginTableColumn = { id: "ops", header: "", kind: "actions", sortable: false };
  const textCol: PluginTableColumn = { id: "name", header: "Server" };
  const row: PluginTableRow = {
    id: "cluster:dev",
    cells: {
      name: "dev",
      ops: [
        { id: "stop", label: "Stop", icon: "mdi--stop", command: "pg_row_stop" },
        { id: "restart", label: "Restart", command: "pg_row_restart" },
      ],
    },
  };

  it("parses valid buttons, keeps icon/command", () => {
    expect(getCellActions(row, opsCol)).toEqual([
      { id: "stop", label: "Stop", icon: "mdi--stop", command: "pg_row_stop" },
      { id: "restart", label: "Restart", command: "pg_row_restart" },
    ]);
  });

  it("drops invalid entries and caps at 4", () => {
    const bad: PluginTableRow = {
      id: "x",
      cells: {
        ops: [
          null,
          "nope",
          { id: "", label: "empty id" },
          { id: "nolabel" },
          { id: "ok1", label: "Ok 1" },
          { id: "ok2", label: "Ok 2" },
          { id: "ok3", label: "Ok 3" },
          { id: "ok4", label: "Ok 4" },
          { id: "ok5", label: "Ok 5" },
        ],
      },
    };
    expect(getCellActions(bad, opsCol).map((a) => a.id)).toEqual(["ok1", "ok2", "ok3", "ok4"]);
  });

  it("returns [] for non-actions columns and non-array cells", () => {
    expect(getCellActions(row, textCol)).toEqual([]);
    expect(getCellActions({ id: "y", cells: {} }, opsCol)).toEqual([]);
    expect(getCellActions({ id: "z", cells: { ops: "Stop" } }, opsCol)).toEqual([]);
  });

  it("exposes joined labels as cell text (searchable, stable sort key)", () => {
    expect(getCellText(row, opsCol)).toBe("Stop Restart");
    expect(getCellText({ id: "y", cells: {} }, opsCol)).toBe("");
  });

  it("filters rows by button label", () => {
    const cols = [textCol, opsCol];
    expect(filterRows([row], cols, "restart")).toHaveLength(1);
    expect(filterRows([row], cols, "STOP")).toHaveLength(1);
    expect(filterRows([row], cols, "destroy")).toHaveLength(0);
  });
});
