import type { StableError } from "~/types/error";

/** Unknown is a non-array object (covers plain records, class instances, Errors). */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Alias for call sites that mean "plain JSON object", not an array. */
export const isPlainObject = isRecord;

export function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

export function asTrimmed(v: unknown, fallback = ""): string {
  const s = asString(v, fallback).trim();
  return s || fallback;
}

export function isStableError(v: unknown): v is StableError {
  return isRecord(v) && typeof v.code === "string" && typeof v.message === "string";
}
