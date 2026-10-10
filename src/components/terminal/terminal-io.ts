// Shared terminal IO: one process-wide Tauri event fan-out plus an ordered
// per-session PTY write queue.
//
// Background: every mounted TerminalHost used to register its own
// "embedded-terminal-data" listener and EACH handler appended the chunk to
// the replay buffer, so N open tabs stored every chunk N times. This module
// keeps a single listener that appends exactly once and fans out to
// per-session subscribers (display only). Writes are chained per session so
// rapid keystrokes — especially Enter in raw-mode prompts like `bun x bumpp`
// — reach the PTY in order instead of racing one invoke per keystroke.

import { listen } from "@tauri-apps/api/event";

import { appendTerminalChunk } from "~/features/project-detail/lib/terminal-buffer";
import { isRecord } from "~/lib/guards";
import { embeddedTerminalWrite } from "~/services/tauri/terminal";

export type TerminalDataPayload = {
  sessionId: string;
  chunk: string;
};

export type TerminalExitPayload = {
  sessionId: string;
};

/** True for non-empty strings only — guards paste/clipboard and xterm onData payloads. */
export function isTerminalInput(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function decodeTerminalChunk(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

function readPayloadString(payload: unknown, key: string): string {
  if (!isRecord(payload)) return "";
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

type ChunkCallback = (chunk: string) => void;
type ExitCallback = () => void;

const chunkSubscribers = new Map<string, Set<ChunkCallback>>();
const exitSubscribers = new Map<string, Set<ExitCallback>>();

let dataListenerReady = false;
let exitListenerReady = false;

/** Ensure the singleton data listener exists so early output is buffered even before a display subscribes. */
export function ensureTerminalListeners(): void {
  if (!dataListenerReady) {
    dataListenerReady = true;
    void listen<TerminalDataPayload>("embedded-terminal-data", (event) => {
      const sessionId = readPayloadString(event.payload, "sessionId");
      const chunk = readPayloadString(event.payload, "chunk");
      if (!sessionId || !chunk) return;
      // Single store: exactly one append no matter how many tabs are mounted.
      appendTerminalChunk(sessionId, chunk);
      const subs = chunkSubscribers.get(sessionId);
      if (!subs) return;
      for (const cb of subs) {
        try {
          cb(chunk);
        } catch (err) {
          console.error("terminal chunk subscriber failed:", err);
        }
      }
    }).catch(() => {
      // Process-lifetime listener; a later subscribe retries after failure.
      dataListenerReady = false;
    });
  }
  if (!exitListenerReady) {
    exitListenerReady = true;
    void listen<TerminalExitPayload>("embedded-terminal-exit", (event) => {
      const sessionId = readPayloadString(event.payload, "sessionId");
      if (!sessionId) return;
      const subs = exitSubscribers.get(sessionId);
      if (!subs) return;
      for (const cb of subs) {
        try {
          cb();
        } catch (err) {
          console.error("terminal exit subscriber failed:", err);
        }
      }
    }).catch(() => {
      exitListenerReady = false;
    });
  }
}

/** Subscribe to display chunks for one session. The shared listener appends to the buffer exactly once. */
export function subscribeTerminalData(sessionId: string, onChunk: ChunkCallback): () => void {
  ensureTerminalListeners();
  let set = chunkSubscribers.get(sessionId);
  if (!set) {
    set = new Set();
    chunkSubscribers.set(sessionId, set);
  }
  set.add(onChunk);
  return () => {
    const live = chunkSubscribers.get(sessionId);
    if (live) {
      live.delete(onChunk);
      if (live.size === 0) chunkSubscribers.delete(sessionId);
    }
  };
}

/** Subscribe to the exit event for one session. */
export function subscribeTerminalExit(sessionId: string, onExit: ExitCallback): () => void {
  ensureTerminalListeners();
  let set = exitSubscribers.get(sessionId);
  if (!set) {
    set = new Set();
    exitSubscribers.set(sessionId, set);
  }
  set.add(onExit);
  return () => {
    const live = exitSubscribers.get(sessionId);
    if (live) {
      live.delete(onExit);
      if (live.size === 0) exitSubscribers.delete(sessionId);
    }
  };
}

export type TerminalWriteFn = (sessionId: string, data: string) => unknown;

/** A single backend write slower than this logs a warning. */
export const TERMINAL_SLOW_WRITE_MS = 1000;

/** Pending writes beyond this depth log a warning (once per crossing). */
export const TERMINAL_WRITE_QUEUE_WARN_DEPTH = 10;

async function runTerminalWrite(
  write: TerminalWriteFn,
  sessionId: string,
  data: string,
): Promise<void> {
  const startedAt = Date.now();
  try {
    const out: unknown = write(sessionId, data);
    if (isRecord(out) && typeof out.mapErr === "function") {
      // neverthrow ResultAsync: log failures, never throw.
      (out.mapErr as (fn: (err: unknown) => void) => void)((err: unknown) => {
        console.error("terminal write error:", err);
      });
    }
    await out;
  } catch (err) {
    console.error("terminal write error:", err);
  }
  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs > TERMINAL_SLOW_WRITE_MS) {
    console.warn(`terminal write slow: session ${sessionId} took ${elapsedMs}ms`);
  }
}

/**
 * Promise-chained per-session write queue. Non-string/empty payloads are
 * skipped so a stray "undefined" can never reach the PTY as literal input.
 */
export function createTerminalWriteQueue(
  write: TerminalWriteFn,
): (sessionId: unknown, data: unknown) => void {
  const tails = new Map<string, Promise<void>>();
  const pending = new Map<string, number>();
  return (sessionId: unknown, data: unknown) => {
    if (!isTerminalInput(sessionId) || !isTerminalInput(data)) return;
    const sid: string = sessionId;
    const text: string = data;
    const depth = (pending.get(sid) ?? 0) + 1;
    pending.set(sid, depth);
    if (depth === TERMINAL_WRITE_QUEUE_WARN_DEPTH) {
      console.warn(`terminal write queue deep: session ${sid} has ${depth} pending writes`);
    }
    const prev = tails.get(sid) ?? Promise.resolve();
    const next = prev.then(() => runTerminalWrite(write, sid, text));
    tails.set(sid, next);
    // Drop the tail once drained so the maps do not grow with dead sessions.
    void next.then(() => {
      const left = (pending.get(sid) ?? 1) - 1;
      if (left <= 0) pending.delete(sid);
      else pending.set(sid, left);
      if (tails.get(sid) === next) tails.delete(sid);
    });
  };
}

/** Default queue wired to the real backend invoke. */
const defaultQueue = createTerminalWriteQueue((sid, text) => embeddedTerminalWrite(sid, text));

export function queueTerminalWrite(sessionId: unknown, data: unknown): void {
  defaultQueue(sessionId, data);
}
