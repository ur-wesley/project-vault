import { describe, expect, it } from "vitest";

import { formatCommandTitle, parseCommandFromLine } from "./parse-command-title";

describe("parseCommandFromLine", () => {
  it("strips prompt and trailing nushell date", () => {
    expect(
      parseCommandFromLine("C:\\proj> git status                    09/16/2026 10:40:12 AM"),
    ).toBe("git status");
  });

  it("strips ISO date suffix", () => {
    expect(parseCommandFromLine("> cargo build  2026-09-16")).toBe("cargo build");
  });

  it("strips bash-style prompt", () => {
    expect(parseCommandFromLine("user@host$ ls")).toBe("ls");
  });

  it("returns null for empty input", () => {
    expect(parseCommandFromLine("   ")).toBeNull();
  });
});

describe("formatCommandTitle", () => {
  it("truncates long commands", () => {
    const long = "a".repeat(40);
    expect(formatCommandTitle(long)).toBe(`${"a".repeat(30)}…`);
  });
});
