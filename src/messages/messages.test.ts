import { describe, expect, it } from "vitest";

import de from "./de";
import en from "./en";

function flatKeys(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    flatKeys(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe("i18n key sync", () => {
  it("de.ts exports the same key set as en.ts (no drift)", () => {
    const enKeys = new Set(flatKeys(en));
    const deKeys = new Set(flatKeys(de));
    const missing = [...enKeys].filter((k) => !deKeys.has(k));
    const extra = [...deKeys].filter((k) => !enKeys.has(k));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });
});
