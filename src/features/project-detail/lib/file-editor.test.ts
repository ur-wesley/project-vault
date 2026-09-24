import { describe, expect, it } from "vitest";

import { previewKindOf } from "./file-editor";

describe("previewKindOf", () => {
  it("detects markdown files case-insensitively", () => {
    expect(previewKindOf("README.md")).toBe("markdown");
    expect(previewKindOf("docs/notes.MARKDOWN")).toBe("markdown");
    expect(previewKindOf("post.mdx")).toBe("markdown");
  });

  it("detects html files", () => {
    expect(previewKindOf("index.html")).toBe("html");
    expect(previewKindOf("page.HTM")).toBe("html");
  });

  it("returns null for code, text and binary files", () => {
    expect(previewKindOf("main.ts")).toBeNull();
    expect(previewKindOf("notes.txt")).toBeNull();
    expect(previewKindOf("photo.png")).toBeNull();
    expect(previewKindOf("doc.pdf")).toBeNull();
    expect(previewKindOf("Makefile")).toBeNull();
  });
});
