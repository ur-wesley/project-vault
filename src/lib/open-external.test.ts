import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const tauriState = vi.hoisted(() => ({ isTauri: false }));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => tauriState.isTauri,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(async () => {}),
}));

const NUL = String.fromCharCode(0);
const BEL = String.fromCharCode(7);
const NBSP = String.fromCharCode(160);

import { openUrl } from "@tauri-apps/plugin-opener";

import { isAllowedExternalHref, openExternal } from "./open-external";

let openUrlMock: Mock;
const windowOpenMock = vi.fn(() => null);
const warnMock = vi.spyOn(console, "warn").mockImplementation(() => {});

beforeEach(() => {
  openUrlMock = vi.mocked(openUrl);
  tauriState.isTauri = true;
  openUrlMock.mockClear();
  windowOpenMock.mockClear();
  warnMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isAllowedExternalHref", () => {
  it.each([
    "http://example.com",
    "https://example.com/path?q=1",
    "HTTPS://EXAMPLE.COM",
    "HtTp://example.com",
    "mailto:foo@example.com",
    "MAILTO:Foo@Example.com",
    "tel:+1-555-0100",
    "TEL:123",
    "https://example.com  ",
  ])("allows %s", (href) => {
    expect(isAllowedExternalHref(href)).toBe(true);
  });

  it.each([
    "file:///etc/passwd",
    "FILE:///etc/passwd",
    "data:text/html,<script>alert(1)</script>",
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "vbscript:msgbox(1)",
    "VBScript:x",
    "vscode://file/foo",
    "ftp://example.com/x",
    "//evil.com/path",
    "  https://example.com",
    "\thttps://example.com",
    "\nhttps://example.com",
    `${NUL}https://example.com`,
    `${BEL}https://example.com`,
    `${NBSP}https://example.com`,
    "example.com",
    "/relative/path",
    "relative/path",
    "",
    "   ",
    "java\tscript:alert(1)",
  ])("blocks %s", (href) => {
    expect(isAllowedExternalHref(href)).toBe(false);
  });
});

describe("openExternal scheme gating (Tauri)", () => {
  it.each(["http://example.com", "https://example.com/x", "mailto:foo@example.com", "tel:+123"])(
    "opens allowlisted %s via openUrl",
    async (href) => {
      await openExternal(href);
      expect(openUrlMock).toHaveBeenCalledTimes(1);
      expect(openUrlMock).toHaveBeenCalledWith(href);
      expect(warnMock).not.toHaveBeenCalled();
    },
  );

  it("trims trailing whitespace before opening", async () => {
    await openExternal("https://example.com  ");
    expect(openUrlMock).toHaveBeenCalledWith("https://example.com");
  });

  it.each([
    "file:///etc/passwd",
    "data:text/html,hi",
    "javascript:alert(1)",
    "vbscript:x",
    "//evil.com/path",
    "  https://example.com",
    "\thttps://example.com",
    `${NUL}https://example.com`,
    "example.com",
    "",
  ])("blocks %s: no openUrl, warns once", async (href) => {
    await openExternal(href);
    expect(openUrlMock).not.toHaveBeenCalled();
    expect(warnMock).toHaveBeenCalledTimes(1);
  });
});

describe("openExternal web fallback", () => {
  beforeEach(() => {
    tauriState.isTauri = false;
    vi.stubGlobal("window", { open: windowOpenMock });
  });

  it("opens allowlisted URLs in a new tab", async () => {
    await openExternal("https://example.com");
    expect(windowOpenMock).toHaveBeenCalledWith(
      "https://example.com",
      "_blank",
      "noopener,noreferrer",
    );
    expect(openUrlMock).not.toHaveBeenCalled();
  });

  it("blocks non-allowlisted URLs without touching window.open", async () => {
    await openExternal("file:///etc/passwd");
    expect(windowOpenMock).not.toHaveBeenCalled();
    expect(openUrlMock).not.toHaveBeenCalled();
    expect(warnMock).toHaveBeenCalledTimes(1);
  });
});
