import { describe, expect, it } from "vitest";

import { parsePluginIcon, pluginIconToSvgString, resolvePluginIconData } from "./plugin-icon";

const FIXTURE_COLLECTION = {
  prefix: "mdi",
  icons: {
    anchor: {
      body: '<path d="M12 2v20"/>',
      width: 24,
      height: 24,
    },
  },
  width: 24,
  height: 24,
};

describe("parsePluginIcon", () => {
  it("parses mdi--anchor", () => {
    expect(parsePluginIcon("mdi--anchor")).toEqual({ prefix: "mdi", name: "anchor" });
  });

  it("parses mdi:anchor", () => {
    expect(parsePluginIcon("mdi:anchor")).toEqual({ prefix: "mdi", name: "anchor" });
  });

  it("parses catppuccin and devicon-plain", () => {
    expect(parsePluginIcon("catppuccin--javascript")).toEqual({
      prefix: "catppuccin",
      name: "javascript",
    });
    expect(parsePluginIcon("devicon-plain--vscode")).toEqual({
      prefix: "devicon-plain",
      name: "vscode",
    });
  });

  it("rejects unknown prefix", () => {
    expect(parsePluginIcon("foo--bar")).toBeNull();
  });

  it("rejects empty and malformed", () => {
    expect(parsePluginIcon("")).toBeNull();
    expect(parsePluginIcon("mdi--")).toBeNull();
    expect(parsePluginIcon("--anchor")).toBeNull();
  });
});

describe("resolvePluginIconData", () => {
  it("resolves icon from collection", () => {
    const data = resolvePluginIconData(FIXTURE_COLLECTION, "anchor");
    expect(data).toEqual({
      body: '<path d="M12 2v20"/>',
      width: 24,
      height: 24,
    });
  });

  it("returns null for missing icon", () => {
    expect(resolvePluginIconData(FIXTURE_COLLECTION, "missing")).toBeNull();
  });
});

describe("pluginIconToSvgString", () => {
  it("renders inline svg", () => {
    const data = resolvePluginIconData(FIXTURE_COLLECTION, "anchor")!;
    const svg = pluginIconToSvgString(data);
    expect(svg).toContain("<svg");
    expect(svg).toContain('<path d="M12 2v20"/>');
  });
});
