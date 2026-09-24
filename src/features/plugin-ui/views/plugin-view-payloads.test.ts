// Regression coverage for the native view payloads emitted by
// pv-plugins/postgres (views.luau render_home) and pv-plugins/git-hygiene
// (view.luau build_view): they must survive parseViewSpec/TableViewSchema
// or the plugin pages render blank.
import { describe, expect, it } from "vitest";
import {
  parseViewSpec,
  TableViewSchema,
  findRowCommand,
  parsePageActions,
} from "~/features/plugin-ui/types";

// Mirrors postgres/views.luau render_home() with empty state:
// title "Postgres (0 running)", no servers/versions/browse/query rows.
function postgresEmptyHome() {
  const stats = {
    kind: "stats",
    items: [
      { id: "running", label: "Running", value: "0", icon: "mdi--play", tone: "muted" },
      { id: "servers", label: "Servers", value: "0", icon: "mdi--server", tone: "default" },
      { id: "versions", label: "Versions", value: "0/0", icon: "mdi--database", tone: "info" },
    ],
  };
  return {
    kind: "stack",
    children: [
      stats,
      {
        kind: "tabs",
        tabs: [
          {
            id: "servers",
            label: "Servers",
            view: {
              kind: "table",
              columns: [
                { id: "name", header: "Server", sortable: true },
                { id: "kind", header: "Kind", kind: "badge" },
                { id: "detail", header: "Detail", kind: "code" },
                { id: "status", header: "Status", kind: "badge" },
              ],
              rows: [],
              searchable: true,
              pageSize: 20,
              rowCommand: "open_connection",
            },
          },
          {
            id: "versions",
            label: "Versions",
            view: {
              kind: "table",
              columns: [
                { id: "version", header: "Version", sortable: true },
                { id: "state", header: "State", kind: "badge" },
              ],
              rows: [],
              searchable: false,
              pageSize: 10,
              rowCommand: "manage_version",
            },
          },
          {
            id: "browse",
            label: "Browse",
            view: {
              kind: "stack",
              children: [
                { kind: "markdown", content: "Select a server first" },
                {
                  kind: "table",
                  columns: [{ id: "name", header: "Name" }],
                  rows: [],
                  searchable: true,
                  pageSize: 20,
                  // browse_command is nil in Lua -> key ABSENT after serde
                },
              ],
            },
          },
          {
            id: "query",
            label: "Query",
            view: {
              kind: "stack",
              children: [
                { kind: "markdown", content: "No query yet." },
                {
                  kind: "table",
                  columns: [{ id: "value", header: "value" }],
                  rows: [],
                  searchable: true,
                  pageSize: 20,
                },
              ],
            },
          },
          {
            id: "logs",
            label: "Logs",
            view: { kind: "markdown", content: "Select a server first" },
          },
        ],
      },
    ],
  };
}

// Mirrors git-hygiene/view.luau build_view() with zero entries.
function hygieneEmptyView() {
  return {
    kind: "stack",
    children: [{ kind: "markdown", content: "All clean! No dirty or unpushed projects." }],
  };
}

function hygieneColumns() {
  return [
    { id: "name", header: "Project", sortable: true },
    { id: "status", header: "Status", kind: "badge", sortable: true },
    { id: "branch", header: "Branch", kind: "code", sortable: true },
    { id: "ahead", header: "Ahead", sortable: true, align: "right", width: 80 },
    { id: "behind", header: "Behind", sortable: true, align: "right", width: 80 },
  ];
}

function hygieneTable(rows: unknown[], searchable: boolean) {
  return {
    kind: "table",
    columns: hygieneColumns(),
    rows,
    searchable,
    sortable: true,
    pageSize: 20,
    rowCommand: "open_item",
  };
}

// Mirrors git-hygiene/view.luau build_view() with one dirty project.
function hygieneDirtyView() {
  const dirtyRows = [
    {
      id: "proj-1",
      cells: { name: "demo", status: "Dirty", branch: "main", ahead: 0, behind: 0 },
    },
  ];
  return {
    kind: "stack",
    children: [
      {
        kind: "markdown",
        content: "Scanned 1 project(s) needing attention · last scan 2026-09-23 12:00",
      },
      {
        kind: "tabs",
        tabs: [
          { id: "all", label: "All (1)", view: hygieneTable(dirtyRows, true) },
          { id: "dirty", label: "Dirty (1)", view: hygieneTable(dirtyRows, true) },
          { id: "unpushed", label: "Unpushed (0)", view: hygieneTable([], false) },
          { id: "no_upstream", label: "No upstream (0)", view: hygieneTable([], false) },
          { id: "behind", label: "Behind (0)", view: hygieneTable([], false) },
        ],
      },
    ],
  };
}

describe("diag: postgres empty home payload", () => {
  it("parses as stack", () => {
    const parsed = parseViewSpec(postgresEmptyHome());
    expect(parsed.kind).toBe("stack");
  });
  it("each table validates", () => {
    const home = postgresEmptyHome() as any;
    const tabs = home.children[1].tabs as any[];
    for (const tab of tabs) {
      const collect: any[] = [];
      const walk = (v: any) => {
        if (v.kind === "table") collect.push(v);
        for (const c of v.children ?? []) walk(c);
      };
      walk(tab.view);
      for (const t of collect) {
        expect(() => TableViewSchema.parse(t), `tab ${tab.id}`).not.toThrow();
      }
    }
  });
  it("row command resolution", () => {
    // Page-level fallback when a table carries no rowCommand of its own:
    // first rowCommand wins. The renderer now prefers each table's own
    // rowCommand; this fallback only covers specs without one.
    expect(findRowCommand(postgresEmptyHome())).toBe("open_connection");
  });
  it("each tab keeps its own row command for per-table routing", () => {
    const home = postgresEmptyHome() as any;
    const byId: Record<string, any> = {};
    for (const tab of home.children[1].tabs as any[]) byId[tab.id] = tab.view;
    expect(byId.servers.rowCommand).toBe("open_connection");
    expect(byId.versions.rowCommand).toBe("manage_version");
  });
});

describe("page actions", () => {
  it("servers table with per-row ops buttons validates", () => {
    // Mirrors pv-plugins/postgres init.luau servers_table(): managed rows
    // carry an `ops` actions-column cell with lifecycle buttons.
    const table = {
      kind: "table",
      columns: [
        { id: "name", header: "Server", sortable: true },
        { id: "kind", header: "Kind", kind: "badge" },
        { id: "detail", header: "Detail", kind: "code" },
        { id: "status", header: "Status", kind: "badge" },
        { id: "backend", header: "Backend", kind: "badge" },
        { id: "extensions", header: "Extensions" },
        { id: "ops", header: "", kind: "actions", sortable: false },
      ],
      rows: [
        {
          id: "cluster:dev",
          cells: {
            name: "dev",
            kind: "managed",
            detail: "pg16 :5436",
            status: "stopped",
            backend: "portable",
            extensions: "pg_trgm",
            ops: [{ id: "start", label: "Start", icon: "mdi--play", command: "pg_row_start" }],
          },
        },
        {
          id: "cluster:prod",
          cells: {
            name: "prod",
            kind: "managed",
            detail: "pg16 :5437",
            status: "running",
            backend: "docker",
            extensions: "timescale",
            ops: [
              { id: "stop", label: "Stop", icon: "mdi--stop", command: "pg_row_stop" },
              { id: "restart", label: "Restart", icon: "mdi--restart", command: "pg_row_restart" },
            ],
          },
        },
      ],
      searchable: true,
      pageSize: 20,
      rowCommand: "open_connection",
    };
    expect(() => TableViewSchema.parse(table)).not.toThrow();
  });
  it("passes valid actions through", () => {
    expect(
      parsePageActions([
        { id: "new", label: "New", icon: "mdi--plus", command: "pg_create" },
        { id: "settings", label: "Settings" },
      ]),
    ).toEqual([
      { id: "new", label: "New", icon: "mdi--plus", command: "pg_create" },
      { id: "settings", label: "Settings" },
    ]);
  });
  it("drops invalid entries and caps at 8", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, label: `A${i}` }));
    expect(parsePageActions([...many, null, { id: "", label: "" }, "x"])).toHaveLength(8);
    expect(parsePageActions(undefined)).toEqual([]);
    expect(parsePageActions("nope")).toEqual([]);
  });
});

describe("diag: git-hygiene payloads", () => {
  it("empty view parses", () => {
    expect(parseViewSpec(hygieneEmptyView()).kind).toBe("stack");
  });
  it("dirty view parses + each tab table validates", () => {
    const v = hygieneDirtyView() as any;
    expect(parseViewSpec(v).kind).toBe("stack");
    const tabs = v.children[1].tabs as any[];
    expect(tabs.map((t) => t.id)).toEqual(["all", "dirty", "unpushed", "no_upstream", "behind"]);
    for (const tab of tabs) {
      expect(() => TableViewSchema.parse(tab.view), `tab ${tab.id}`).not.toThrow();
      expect(tab.view.rowCommand).toBe("open_item");
    }
    expect(findRowCommand(v)).toBe("open_item");
  });
  it("dirty view header actions validate", () => {
    expect(
      parsePageActions([
        { id: "refresh", label: "Refresh", icon: "mdi--refresh", command: "refresh_scan" },
        { id: "settings", label: "Settings", icon: "mdi--cog", command: "show_settings" },
      ]),
    ).toHaveLength(2);
  });
});
