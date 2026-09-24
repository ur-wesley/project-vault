// @vitest-environment happy-dom
// Dispatch contract for `kind: "actions"` cells: button clicks must invoke
// onRowClick(rowId, button.command) and must NOT trigger the table's
// rowCommand; plain row clicks still dispatch rowCommand.
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { PluginTableView } from "./PluginTableView";
import type { PluginTableView as TableSpec } from "../types";

const spec: TableSpec = {
  kind: "table",
  columns: [
    { id: "name", header: "Server", sortable: true },
    { id: "status", header: "Status", kind: "badge" },
    { id: "ops", header: "", kind: "actions", sortable: false },
  ],
  rows: [
    {
      id: "cluster:dev",
      cells: {
        name: "dev",
        status: "stopped",
        ops: [{ id: "start", label: "Start", icon: "mdi--play", command: "pg_row_start" }],
      },
    },
  ],
  searchable: false,
  pageSize: 20,
  rowCommand: "open_connection",
};

describe("PluginTableView actions cells", () => {
  afterEach(() => cleanup());

  it("button click dispatches the button command with the row id", async () => {
    const onRowClick = vi.fn();
    render(() => <PluginTableView spec={spec} onRowClick={onRowClick} />);
    const btn = await screen.findByRole("button", { name: "Start" });
    fireEvent.click(btn);
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith("cluster:dev", "pg_row_start");
  });

  it("button click does not fire the table rowCommand", async () => {
    const onRowClick = vi.fn();
    render(() => <PluginTableView spec={spec} onRowClick={onRowClick} />);
    const btn = await screen.findByRole("button", { name: "Start" });
    fireEvent.click(btn);
    expect(onRowClick).not.toHaveBeenCalledWith("cluster:dev", "open_connection");
  });

  it("plain row click still dispatches rowCommand", async () => {
    const onRowClick = vi.fn();
    render(() => <PluginTableView spec={spec} onRowClick={onRowClick} />);
    fireEvent.click(await screen.findByText("dev"));
    expect(onRowClick).toHaveBeenCalledWith("cluster:dev", "open_connection");
  });
});
