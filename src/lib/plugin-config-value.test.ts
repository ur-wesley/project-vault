import { describe, expect, it } from "vitest";
import { configDefaultToString } from "./plugin-config-value";

describe("configDefaultToString", () => {
  it("coerces booleans", () => {
    expect(configDefaultToString(true)).toBe("true");
    expect(configDefaultToString(false)).toBe("false");
  });

  it("coerces null and undefined to empty string", () => {
    expect(configDefaultToString(null)).toBe("");
    expect(configDefaultToString(undefined)).toBe("");
  });

  it("coerces numbers and strings", () => {
    expect(configDefaultToString(60)).toBe("60");
    expect(configDefaultToString(0)).toBe("0");
    expect(configDefaultToString("right")).toBe("right");
  });
});
