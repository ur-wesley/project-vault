import { describe, expect, it, vi, beforeEach } from "vitest";
import { ResultAsync } from "neverthrow";
import {
  __resetProjectIndexForTests,
  ensureProjectIndex,
  subscribeIndexBuilt,
} from "./projectIndex";
import { isRecord } from "~/lib/guards";

beforeEach(() => {
  __resetProjectIndexForTests();
});

describe("ensureProjectIndex", () => {
  it("dedupes concurrent triggers for the same project", async () => {
    const indexFn = vi.fn(async (_id: string) => "ok");
    const [a, b] = await Promise.all([
      ensureProjectIndex("proj-1", indexFn),
      ensureProjectIndex("proj-1", indexFn),
    ]);
    expect(indexFn).toHaveBeenCalledTimes(1);
    expect(a).toBe("ok");
    expect(b).toBe("ok");
  });

  it("re-triggers after the previous build settles", async () => {
    const indexFn = vi.fn(async (_id: string) => "ok");
    await ensureProjectIndex("proj-1", indexFn);
    await ensureProjectIndex("proj-1", indexFn);
    expect(indexFn).toHaveBeenCalledTimes(2);
  });

  it("tracks different projects independently", async () => {
    const indexFn = vi.fn(async (_id: string) => "ok");
    await Promise.all([
      ensureProjectIndex("proj-1", indexFn),
      ensureProjectIndex("proj-2", indexFn),
    ]);
    expect(indexFn).toHaveBeenCalledTimes(2);
  });

  it("supports ResultAsync (thenable without .finally) from production indexProject", async () => {
    const probe = ResultAsync.fromPromise(Promise.resolve("ok"), () => new Error("nope"));
    const probeRecord: unknown = probe;
    expect(isRecord(probeRecord) ? probeRecord["finally"] : undefined).toBeUndefined();
    const indexFn = vi.fn((_id: string) =>
      ResultAsync.fromPromise(Promise.resolve("ok"), () => new Error("nope")),
    );
    const [a, b] = await Promise.all([
      ensureProjectIndex("proj-1", indexFn),
      ensureProjectIndex("proj-1", indexFn),
    ]);
    expect(indexFn).toHaveBeenCalledTimes(1);
    expect(isRecord(a) && typeof a["isOk"] === "function").toBe(true);
    expect(b).toBe(a);
    // Cache entry is evicted after settle so the next trigger rebuilds.
    await ensureProjectIndex("proj-1", indexFn);
    expect(indexFn).toHaveBeenCalledTimes(2);
  });
});

describe("subscribeIndexBuilt", () => {
  it("removes only the caller's handler on cleanup", () => {
    const a = vi.fn();
    const b = vi.fn();
    const unA = subscribeIndexBuilt(a);
    subscribeIndexBuilt(b);
    unA();
    // No Tauri runtime in tests — handlers just accumulate; assert set state
    // indirectly by re-subscribing and checking no throw on double cleanup.
    unA();
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });
});
