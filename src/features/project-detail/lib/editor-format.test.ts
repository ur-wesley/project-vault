import { describe, expect, it } from "vitest";

import { trimTrailingWhitespace } from "./editor-format";

describe("trimTrailingWhitespace", () => {
  it("removes trailing spaces and tabs but keeps indentation", () => {
    expect(trimTrailingWhitespace("const a = 1;   \n\tlet b = 2;\t\n")).toBe(
      "const a = 1;\n\tlet b = 2;\n",
    );
  });

  it("collapses multiple trailing blank lines to one newline", () => {
    expect(trimTrailingWhitespace("a\n\n\n")).toBe("a\n");
  });

  it("keeps intentional blank lines inside the file", () => {
    expect(trimTrailingWhitespace("a\n\nb\n")).toBe("a\n\nb\n");
  });

  it("leaves clean text untouched", () => {
    const clean = "fn main() {\n    println!();\n}\n";
    expect(trimTrailingWhitespace(clean)).toBe(clean);
  });

  it("handles empty input", () => {
    expect(trimTrailingWhitespace("")).toBe("\n");
  });
});
