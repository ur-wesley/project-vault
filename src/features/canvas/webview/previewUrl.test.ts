import { describe, expect, it } from "vitest";
import { normalizePreviewUrl } from "./previewUrl";

describe("normalizePreviewUrl", () => {
  it("keeps full URLs untouched", () => {
    expect(normalizePreviewUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(normalizePreviewUrl("https://example.com/a?b=c")).toBe("https://example.com/a?b=c");
  });

  it("defaults bare hosts to http", () => {
    expect(normalizePreviewUrl("localhost:3000")).toBe("http://localhost:3000");
    expect(normalizePreviewUrl("  example.com/path  ")).toBe("http://example.com/path");
  });

  it("passes empty input through", () => {
    expect(normalizePreviewUrl("")).toBe("");
  });
});
