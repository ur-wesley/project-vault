import { describe, expect, it } from "vitest";

import {
  formatCommandTitle,
  isEmptyShellPrompt,
  parseCommandFromLine,
  resolveEnteredCommandTitle,
} from "./parse-command-title";

describe("parseCommandFromLine", () => {
  it("strips prompt and trailing nushell date", () => {
    expect(
      parseCommandFromLine("C:\\proj> git status                    09/16/2026 10:40:12 AM"),
    ).toBe("git status");
    expect(
      parseCommandFromLine("C:\\Arbeit\\svg-studio> bun x bumpp       24.10.2026 10:41:28"),
    ).toBe("bun x bumpp");
  });

  it("strips ISO date suffix", () => {
    expect(parseCommandFromLine("> cargo build  2026-09-16")).toBe("cargo build");
  });

  it("strips bash-style prompt", () => {
    expect(parseCommandFromLine("user@host$ ls")).toBe("ls");
  });

  it("returns null for empty input or interactive CLI prompt lines without a shell terminator", () => {
    expect(parseCommandFromLine("   ")).toBeNull();
    expect(parseCommandFromLine("? Current version 0.0.0 » ")).toBeNull();
    expect(parseCommandFromLine("? Bump? » (Y/n)")).toBeNull();
    expect(parseCommandFromLine("  ↓         as-is 0.0.0")).toBeNull();
  });
});

describe("isEmptyShellPrompt & resolveEnteredCommandTitle", () => {
  it("detects empty shell prompts vs non-shell interactive prompts", () => {
    expect(isEmptyShellPrompt("C:\\Arbeit\\svg-studio> ")).toBe(true);
    expect(isEmptyShellPrompt("C:\\Arbeit\\svg-studio>   24.10.2026 10:41:28")).toBe(true);
    expect(isEmptyShellPrompt("? Current version 0.0.0 » ")).toBe(false);
    expect(isEmptyShellPrompt("? Bump? » (Y/n)")).toBe(false);
    expect(isEmptyShellPrompt("")).toBe(false);
  });

  it("preserves running command title during interactive prompts", () => {
    expect(resolveEnteredCommandTitle("C:\\Arbeit\\svg-studio> bun x bumpp")).toBe("bun x bumpp");
    expect(resolveEnteredCommandTitle("? Current version 0.0.0 » ")).toBeNull();
    expect(resolveEnteredCommandTitle("? Bump? » (Y/n)")).toBeNull();
    expect(resolveEnteredCommandTitle("C:\\Arbeit\\svg-studio> ")).toBe("");
  });
});

describe("formatCommandTitle", () => {
  it("truncates long commands", () => {
    const long = "a".repeat(40);
    expect(formatCommandTitle(long)).toBe(`${"a".repeat(30)}…`);
  });
});
