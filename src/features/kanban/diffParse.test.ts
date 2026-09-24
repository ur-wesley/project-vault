import { describe, expect, it } from "vitest";

import { pairSideBySide, parseUnifiedDiff } from "./diffParse";

const SAMPLE = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 ctx one
-old line
+new line one
+new line two
 ctx two
`;

describe("parseUnifiedDiff", () => {
  it("assigns old/new line numbers", () => {
    const rows = parseUnifiedDiff(SAMPLE);
    const kinds = rows.map((r) => r.kind);
    expect(kinds).toEqual(["meta", "hunk", "ctx", "del", "add", "add", "ctx"]);
    expect(rows[2]).toMatchObject({ oldNo: 1, newNo: 1 });
    expect(rows[3]).toMatchObject({ oldNo: 2, newNo: null });
    expect(rows[4]).toMatchObject({ oldNo: null, newNo: 2 });
    expect(rows[6]).toMatchObject({ oldNo: 3, newNo: 4 });
  });

  it("handles new-file diffs", () => {
    const rows = parseUnifiedDiff("--- /dev/null\n+++ b/new.ts\n+hello\n");
    expect(rows.map((r) => r.kind)).toEqual(["add"]);
    expect(rows[0]).toMatchObject({ newNo: 0, text: "hello" });
  });
});

describe("pairSideBySide", () => {
  it("pairs del runs with following adds", () => {
    const pairs = pairSideBySide(parseUnifiedDiff(SAMPLE));
    // meta, hunk, ctx, (del,new1), (null,new2), ctx
    expect(pairs).toHaveLength(6);
    expect(pairs[3]?.left?.kind).toBe("del");
    expect(pairs[3]?.right?.kind).toBe("add");
    expect(pairs[4]?.left).toBeNull();
    expect(pairs[4]?.right?.text).toBe("new line two");
  });
});
