import { createQuery } from "@tanstack/solid-query";
import { isRecord } from "~/lib/guards";

type NodeResult<T> = { isOk(): boolean; value?: T | null; error?: unknown } | T | null | undefined;

function hasIsOk<T>(res: unknown): res is { isOk(): boolean; value?: T | null } {
  return isRecord(res) && typeof res.isOk === "function";
}

/**
 * Thin TanStack Query wrapper for canvas nodes.
 * Eliminates the repeated `res.isOk() ? res.value : fallback` dance —
 * every tauri service returns a neverthrow Result, so unwrap once here.
 */
export function useNodeQuery<T>(opts: {
  key: readonly unknown[];
  fn: () => Promise<NodeResult<T>>;
  fallback?: T | null;
  refetchInterval?: number;
  enabled?: boolean;
}) {
  return createQuery(() => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    queryKey: opts.key as any,
    queryFn: async (): Promise<T | null> => {
      const res = await opts.fn();
      if (hasIsOk<T>(res)) {
        if (res.isOk()) return res.value ?? opts.fallback ?? null;
        return opts.fallback ?? null;
      }
      return (res ?? opts.fallback ?? null) as T | null;
    },
    refetchInterval: opts.refetchInterval,
    enabled: opts.enabled,
    retry: false,
  }));
}
