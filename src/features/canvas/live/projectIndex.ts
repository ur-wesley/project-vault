import { indexProject } from "~/services/tauri/search";

// `unknown` (not `PromiseLike`) because production `indexProject` returns a
// neverthrow `ResultAsync`, whose `.then` signature is incompatible with the
// DOM `PromiseLike` type. At runtime `Promise.resolve()` assimilates any
// thenable, so `ensureProjectIndex` normalizes before attaching cleanup.
type IndexFn = (projectId: string) => unknown;

/** In-flight index builds per project — concurrent callers share one IPC call. */
const inflight = new Map<string, Promise<unknown>>();

/**
 * Ensures the search index build for a project is running, deduplicating
 * concurrent triggers. Previously every filePreview node on a canvas fired
 * its own `indexProject` IPC when the index meta was missing — N nodes meant
 * N concurrent full index builds for the same project.
 *
 * The `indexFn` parameter exists for tests; production callers omit it.
 */
export function ensureProjectIndex(projectId: string, indexFn: IndexFn = indexProject) {
  const hit = inflight.get(projectId);
  if (hit) return hit;
  // `indexProject` returns a neverthrow `ResultAsync`, which is thenable
  // (has `.then`) but has no `.finally`/`.catch`. Normalize to a native
  // promise first so cleanup works for both native promises (tests) and
  // `ResultAsync` (production). The resolved value is the `Result`, which
  // callers already handle via `.then`/`await`.
  let p: Promise<unknown>;
  const clearIfCurrent = () => {
    if (inflight.get(projectId) === p) inflight.delete(projectId);
  };
  p = Promise.resolve(indexFn(projectId)).then(
    (value) => {
      clearIfCurrent();
      return value;
    },
    (err) => {
      clearIfCurrent();
      throw err;
    },
  );
  inflight.set(projectId, p);
  return p;
}

export type IndexBuiltFn = (projectId: string) => void;

const handlers = new Set<IndexBuiltFn>();
let tauriUnlisten: (() => void) | undefined;
let listening = false;

async function ensureListening(): Promise<void> {
  if (listening) return;
  listening = true;
  try {
    const { listen } = await import("@tauri-apps/api/event");
    tauriUnlisten = await listen<{ projectId: string }>("index:built", (ev) => {
      const pid = ev.payload.projectId;
      handlers.forEach((fn) => {
        try {
          fn(pid);
        } catch {
          // a broken handler must not break sibling nodes
        }
      });
    });
  } catch {
    listening = false;
  }
}

/**
 * Shared `index:built` subscription. Previously every filePreview node
 * registered its own Tauri event listener; now the first subscriber installs
 * exactly one process-wide listener and fan-out is a local Set iteration.
 * Returned cleanup removes only the caller's handler.
 */
export function subscribeIndexBuilt(fn: IndexBuiltFn): () => void {
  handlers.add(fn);
  void ensureListening();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    handlers.delete(fn);
  };
}

/** Test hook: drops cached state between cases. */
export function __resetProjectIndexForTests(): void {
  inflight.clear();
  handlers.clear();
  tauriUnlisten?.();
  tauriUnlisten = undefined;
  listening = false;
}
