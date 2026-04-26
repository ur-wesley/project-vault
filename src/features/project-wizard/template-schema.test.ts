import { describe, expect, it } from "vitest";

import { TemplateSummaryListSchema } from "./template-schema";

describe("TemplateSummaryListSchema", () => {
  it("accepts template list from list_project_templates shape", () => {
    const raw = [
      { id: "bun-typescript", name: "Bun + TypeScript", description: "Minimal." },
      { id: "node-typescript", name: "Node + TypeScript", description: "Minimal." },
    ];
    const parsed = TemplateSummaryListSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toHaveLength(2);
  });
});
