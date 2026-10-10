import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

import { listen } from "@tauri-apps/api/event";
import {
  clearTerminalBuffer,
  getTerminalReplay,
} from "~/features/project-detail/lib/terminal-buffer";
import {
  createTerminalWriteQueue,
  decodeTerminalChunk,
  isTerminalInput,
  subscribeTerminalData,
  subscribeTerminalExit,
  TERMINAL_SLOW_WRITE_MS,
  TERMINAL_WRITE_QUEUE_WARN_DEPTH,
} from "./terminal-io";

function toBase64(text: string): string {
  return btoa(text);
}

function dataHandler(): (ev: { payload: { sessionId: string; chunk: string } }) => void {
  const calls = vi.mocked(listen).mock.calls;
  const found = calls.find((c) => c[0] === "embedded-terminal-data");
  if (!found) throw new Error("data listener not registered");
  return found[1] as (ev: { payload: { sessionId: string; chunk: string } }) => void;
}

function exitHandler(): (ev: { payload: { sessionId: string } }) => void {
  const calls = vi.mocked(listen).mock.calls;
  const found = calls.find((c) => c[0] === "embedded-terminal-exit");
  if (!found) throw new Error("exit listener not registered");
  return found[1] as (ev: { payload: { sessionId: string } }) => void;
}

describe("isTerminalInput", () => {
  it("accepts non-empty strings", () => {
    expect(isTerminalInput("a")).toBe(true);
    expect(isTerminalInput("\r")).toBe(true);
  });

  it("rejects empty and non-string payloads", () => {
    expect(isTerminalInput("")).toBe(false);
    expect(isTerminalInput(undefined)).toBe(false);
    expect(isTerminalInput(null)).toBe(false);
    expect(isTerminalInput(0)).toBe(false);
    expect(isTerminalInput({})).toBe(false);
  });
});

describe("decodeTerminalChunk", () => {
  it("round-trips base64 output", () => {
    const bytes = decodeTerminalChunk(toBase64("hello-123"));
    expect(Array.from(bytes)).toEqual(Array.from(new TextEncoder().encode("hello-123")));
  });
});

describe("subscribeTerminalData", () => {
  // NOTE: the bus keeps one process-wide listener; later tests reuse the
  // listener registered by the first test — no mock clearing here.
  it("appends exactly once with multiple subscribers on one session", () => {
    const sid = `sess-single-${Date.now()}`;
    const seen: string[][] = [[], [], []];
    const unsubs = seen.map((arr) =>
      subscribeTerminalData(sid, (chunk) => {
        arr.push(chunk);
      }),
    );

    // Exactly one process-wide Tauri listener despite three subscribers.
    expect(vi.mocked(listen).mock.calls.filter((c) => c[0] === "embedded-terminal-data"))
      .toHaveLength(1);

    const chunk = toBase64("prompt $ ");
    dataHandler()({ payload: { sessionId: sid, chunk } });

    expect(getTerminalReplay(sid)).toHaveLength(1);
    for (const arr of seen) expect(arr).toEqual([chunk]);

    unsubs.forEach((un) => un());
    clearTerminalBuffer(sid);
  });

  it("isolates sessions and ignores malformed payloads", () => {
    const sidA = `sess-a-${Date.now()}`;
    const sidB = `sess-b-${Date.now()}`;
    const seenA: string[] = [];
    const seenB: string[] = [];
    const unA = subscribeTerminalData(sidA, (c) => {
      seenA.push(c);
    });
    const unB = subscribeTerminalData(sidB, (c) => {
      seenB.push(c);
    });

    const chunk = toBase64("output");
    dataHandler()({ payload: { sessionId: sidA, chunk } });
    expect(getTerminalReplay(sidA)).toHaveLength(1);
    expect(getTerminalReplay(sidB)).toHaveLength(0);
    expect(seenA).toEqual([chunk]);
    expect(seenB).toEqual([]);

    // Malformed events never throw and never append.
    expect(() =>
      dataHandler()({ payload: { sessionId: sidA, chunk: "" } }),
    ).not.toThrow();
    expect(() =>
      (dataHandler() as (ev: unknown) => void)({ payload: null }),
    ).not.toThrow();
    expect(getTerminalReplay(sidA)).toHaveLength(1);

    unA();
    unB();
    clearTerminalBuffer(sidA);
    clearTerminalBuffer(sidB);
  });

  it("stops delivering after unsubscribe", () => {
    const sid = `sess-unsub-${Date.now()}`;
    const seen: string[] = [];
    const un = subscribeTerminalData(sid, (c) => {
      seen.push(c);
    });
    un();

    dataHandler()({ payload: { sessionId: sid, chunk: toBase64("late") } });
    expect(seen).toEqual([]);
    // Buffer still appended exactly once — display unsubscribed, store did not.
    expect(getTerminalReplay(sid)).toHaveLength(1);
    clearTerminalBuffer(sid);
  });
});

describe("subscribeTerminalExit", () => {
  it("fans out per session", () => {
    const sidA = `sess-exit-a-${Date.now()}`;
    const sidB = `sess-exit-b-${Date.now()}`;
    let exitsA = 0;
    let exitsB = 0;
    const unA = subscribeTerminalExit(sidA, () => {
      exitsA += 1;
    });
    const unB = subscribeTerminalExit(sidB, () => {
      exitsB += 1;
    });

    exitHandler()({ payload: { sessionId: sidA } });
    expect(exitsA).toBe(1);
    expect(exitsB).toBe(0);

    unA();
    unB();
  });
});

describe("createTerminalWriteQueue", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("preserves order when the backend is slow", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const write = vi.fn(( _sid: string, data: string): Promise<void> => {
      calls += 1;
      if (calls === 1) return gate.then(() => void order.push(data));
      order.push(data);
      return Promise.resolve();
    });

    const queue = createTerminalWriteQueue(write);
    queue("s1", "a");
    queue("s1", "b");
    queue("s1", "c");

    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    release();
    await vi.waitFor(() => expect(order).toEqual(["a", "b", "c"]));
    expect(write.mock.calls.map((c) => c[1])).toEqual(["a", "b", "c"]);
  });

  it("skips empty and non-string payloads", async () => {
    const write = vi.fn((): Promise<void> => Promise.resolve());
    const queue = createTerminalWriteQueue(write);
    queue("s1", "");
    queue("s1", undefined);
    queue("s1", null);
    queue(null, "x");
    queue("s1", "ok");
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(write).toHaveBeenCalledWith("s1", "ok");
  });

  it("keeps the queue alive after a failing write", async () => {
    const written: string[] = [];
    const write = vi.fn(( _sid: string, data: string): Promise<void> => {
      if (data === "bad") return Promise.reject(new Error("pty gone"));
      written.push(data);
      return Promise.resolve();
    });
    const queue = createTerminalWriteQueue(write);
    queue("s1", "bad");
    queue("s1", "good");
    await vi.waitFor(() => expect(written).toEqual(["good"]));
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("serializes ResultAsync-style writers via mapErr", async () => {
    const seen: string[] = [];
    const write = vi.fn((_sid: string, data: string) => ({
      mapErr: (fn: (err: unknown) => void) => {
        void fn;
        seen.push(data);
      },
    }));
    const queue = createTerminalWriteQueue(write);
    queue("s1", "x");
    queue("s1", "y");
    await vi.waitFor(() => expect(seen).toEqual(["x", "y"]));
  });

  it("warns when a single write takes longer than TERMINAL_SLOW_WRITE_MS", async () => {
    let writeStarted = false;
    const nowSpy = vi
      .spyOn(Date, "now")
      .mockImplementation(() => (writeStarted ? TERMINAL_SLOW_WRITE_MS + 500 : 0));
    const write = vi.fn((): Promise<void> => {
      writeStarted = true;
      return Promise.resolve();
    });
    try {
      const queue = createTerminalWriteQueue(write);
      queue("s1", "x");
      await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
      await vi.waitFor(() =>
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("slow")),
      );
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("stays quiet on fast writes", async () => {
    const write = vi.fn((): Promise<void> => Promise.resolve());
    const queue = createTerminalWriteQueue(write);
    queue("s1", "x");
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    // Let the write + drain microtasks settle, then confirm no stall warnings fired.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("warns once when pending writes cross TERMINAL_WRITE_QUEUE_WARN_DEPTH", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const write = vi.fn((): Promise<void> => gate);
    const queue = createTerminalWriteQueue(write);
    for (let i = 0; i < TERMINAL_WRITE_QUEUE_WARN_DEPTH + 2; i++) {
      queue("s1", `k${i}`);
    }
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    const deep = warnSpy.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes("queue deep"),
    );
    expect(deep).toHaveLength(1);
    expect(String(deep[0]?.[0])).toContain(String(TERMINAL_WRITE_QUEUE_WARN_DEPTH));
    release();
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(TERMINAL_WRITE_QUEUE_WARN_DEPTH + 2));
  });
});
