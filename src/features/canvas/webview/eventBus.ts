/** Single typed event-bus factory — replaces per-file Map/Set subscribe/emit clones. */
export type Unlisten = () => void;

export interface EventBus<T> {
  emit: (e: T) => void;
  subscribe: (fn: (e: T) => void) => Unlisten;
  subscribeKeyed: (key: string, fn: (e: T) => void) => Unlisten;
}

export function createEventBus<T>(opts?: {
  keyOf?: (e: T) => string | null;
  wildcardKey?: string;
}): EventBus<T> {
  const keyed = new Map<string, Set<(e: T) => void>>();
  const global = new Set<(e: T) => void>();

  const emit = (e: T) => {
    const key = opts?.keyOf?.(e) ?? null;
    if (key !== null) {
      keyed.get(key)?.forEach((fn) => {
        try {
          fn(e);
        } catch {
          // overlay sync must never break canvas input
        }
      });
    }
    global.forEach((fn) => {
      try {
        fn(e);
      } catch {
        // ignore
      }
    });
    if (opts?.wildcardKey && key !== opts.wildcardKey) {
      keyed.get(opts.wildcardKey)?.forEach((fn) => {
        try {
          fn(e);
        } catch {
          // ignore
        }
      });
    }
  };

  const subscribe = (fn: (e: T) => void): Unlisten => {
    global.add(fn);
    return () => {
      global.delete(fn);
    };
  };

  const subscribeKeyed = (key: string, fn: (e: T) => void): Unlisten => {
    let set = keyed.get(key);
    if (!set) {
      set = new Set();
      keyed.set(key, set);
    }
    set.add(fn);
    return () => {
      set?.delete(fn);
    };
  };

  return { emit, subscribe, subscribeKeyed };
}

/** Revision-counter bus for viewport changes (pan/zoom/fit/reset). */
export function createRevBus() {
  let rev = 0;
  const listeners = new Set<(rev: number) => void>();
  return {
    rev: () => rev,
    notify: () => {
      rev += 1;
      const current = rev;
      listeners.forEach((fn) => {
        try {
          fn(current);
        } catch {
          // ignore
        }
      });
    },
    subscribe: (fn: (rev: number) => void): Unlisten => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
