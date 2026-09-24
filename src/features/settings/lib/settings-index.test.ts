import { describe, expect, it } from "vitest";

import { filterSettings } from "./settings-index";

const EN_LABELS: Record<string, string> = {
  "settings.language": "Language",
  "settings.tabGeneral": "General",
  "settings.tabShortcuts": "Shortcuts",
  "settings.interfaceTitle": "Interface",
  "settings.interfaceDescription": "Configure the background scan rhythm of the application.",
  "settings.clipboardHistoryTitle": "Clipboard History",
  "settings.dataTitle": "Data",
  "settings.shortcutsAppSection": "App Shortcuts",
  "settings.shortcutsLabelCommandPalette": "Open Command Palette",
  "settings.shortcutsLabelClipboardHistory": "Open Clipboard History",
  "settings.clipboardHistoryEnabled": "Record clipboard history",
  "settings.clipboardHistoryDescription": "System-wide clipboard manager.",
  "settings.githubToken": "GitHub token",
  "settings.tabAccounts": "Accounts",
  "settings.tabLocations": "Locations",
  "locations.title": "Library locations",
  "locations.description": "Folders scanned for projects.",
  "settings.autoStartTitle": "System Startup",
  "settings.autoStartDescription": "Start Project Vault automatically when you log in.",
  "settings.autoStartToggle": "Start on system startup",
  "settings.autoIndexTitle": "Search Indexing",
  "settings.autoIndexDescription": "Automatically index discovered projects for full-text search.",
  "settings.autoIndexToggle": "Automatically index discovered projects",
  "settings.tabMcp": "MCP Server",
  "settings.mcpTitle": "Model Context Protocol (MCP) Server",
  "settings.mcpDescription": "Connect AI coding assistants to Project Vault.",
  "settings.mcpAuthTitle": "Authentication",
  "settings.mcpAuthDescription": "Protect the local MCP server with Bearer token authentication.",
};

const DE_LABELS: Record<string, string> = {
  "settings.tabGeneral": "Allgemein",
  "settings.autoStartTitle": "Systemstart",
  "settings.autoStartDescription": "Project Vault automatisch starten, wenn Sie sich anmelden.",
  "settings.autoStartToggle": "Beim Systemstart starten",
  "settings.autoIndexTitle": "Suchindex",
  "settings.autoIndexDescription":
    "Entdeckte Projekte automatisch für die Volltextsuche indexieren.",
  "settings.autoIndexToggle": "Entdeckte Projekte automatisch indexieren",
  "settings.tabMcp": "MCP Server",
  "settings.mcpTitle": "Model Context Protocol (MCP) Server",
  "settings.mcpDescription": "Verbinde KI-Assistenten mit Project Vault.",
  "settings.mcpAuthTitle": "Authentifizierung",
};

function tEn(key: string): string {
  return EN_LABELS[key] ?? key;
}

function tDe(key: string): string {
  return DE_LABELS[key] ?? key;
}

describe("filterSettings", () => {
  it("returns empty list for blank query", () => {
    expect(filterSettings("", tEn)).toEqual([]);
    expect(filterSettings("   ", tEn)).toEqual([]);
  });

  it("matches subsequence queries against labels", () => {
    const result = filterSettings("lang", tEn);
    expect(result.some((item) => item.id === "general-language")).toBe(true);
  });

  it("returns no results when nothing matches", () => {
    expect(filterSettings("zzzznotfound", tEn)).toEqual([]);
  });

  it("finds clipboard settings ahead of unrelated tabs", () => {
    const result = filterSettings("record clip", tEn);
    expect(result.some((item) => item.id === "general-clipboard-enabled")).toBe(true);
    expect(result[0]?.tab).toBe("general");
  });

  it("includes shortcut rows from the registry", () => {
    const result = filterSettings("palette", tEn);
    expect(result.some((item) => item.id === "shortcut-command-palette-open")).toBe(true);
    expect(result[0]?.tab).toBe("shortcuts");
  });

  it("includes tab-level locations entry", () => {
    const result = filterSettings("library", tEn);
    expect(result.some((item) => item.id === "locations")).toBe(true);
  });

  it("matches section headings", () => {
    expect(filterSettings("interface", tEn).some((item) => item.id === "general-interface")).toBe(
      true,
    );
    expect(
      filterSettings("clipboard history", tEn).some((item) => item.id === "general-clipboard"),
    ).toBe(true);
    expect(filterSettings("data", tEn).some((item) => item.id === "general-data")).toBe(true);
    expect(filterSettings("app shortcuts", tEn).some((item) => item.id === "shortcuts-app")).toBe(
      true,
    );
  });

  it("matches German visible titles like systemstart", () => {
    const result = filterSettings("systemstart", tDe);
    expect(result.some((item) => item.id === "general-auto-start")).toBe(true);
  });

  it("matches compact queries against spaced English titles", () => {
    const result = filterSettings("systemstart", tEn);
    expect(result.some((item) => item.id === "general-auto-start")).toBe(true);
  });

  it("matches German suchindex against search indexing", () => {
    const result = filterSettings("suchindex", tDe);
    expect(result.some((item) => item.id === "general-auto-index")).toBe(true);
  });

  it("matches search indexing against auto-index title", () => {
    const result = filterSettings("search indexing", tEn);
    expect(result.some((item) => item.id === "general-auto-index")).toBe(true);
  });

  it("finds MCP server settings when querying mcp", () => {
    const result = filterSettings("mcp", tEn);
    expect(result.some((item) => item.id === "mcp-server")).toBe(true);
    expect(result[0]?.tab).toBe("mcp");
  });

  it("finds MCP auth settings when querying auth", () => {
    const result = filterSettings("auth", tEn);
    expect(result.some((item) => item.id === "mcp-auth")).toBe(true);
  });

  it("matches German MCP search query", () => {
    const result = filterSettings("mcp", tDe);
    expect(result.some((item) => item.id === "mcp-server")).toBe(true);
    expect(result[0]?.tab).toBe("mcp");
  });
});
