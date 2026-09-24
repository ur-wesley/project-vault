import { isRecord } from "~/lib/guards";

/** Safe JSON parse for node dataJson — returns fallback on missing/malformed input. */
export function parseNodeData<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const v: unknown = JSON.parse(raw);
    if (!isRecord(v)) return fallback;
    return v as T;
  } catch {
    return fallback;
  }
}

/** Encode node data; null clears the payload. */
export function encodeNodeData<T>(data: T | null): string | null {
  if (data == null) return null;
  return JSON.stringify(data);
}
