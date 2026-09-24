import type { StableError } from "~/types/error";
import { isRecord } from "~/lib/guards";

export type TranslateFn = (...args: never[]) => unknown;

export function stableErrorMessage(t: TranslateFn, err: StableError): string {
  const key = `errors.${err.code}`;
  const tr = (t as (key: string) => unknown)(key);
  const generic = typeof tr === "string" && tr !== key ? tr : null;
  const detail = (err.message ?? "").trim();
  if (generic == null) return detail.length > 0 ? detail : (err.message ?? key);
  if (detail.length === 0) return generic;
  if (detail === generic || generic.includes(detail)) return generic;
  return `${generic} — ${detail}`;
}

/// Tauri command failures arrive as `{code, message}` objects, not `Error`s.
/// `String(err)` on those renders "[object Object]" and hides the real cause.
/// Unknown-tolerant formatter for `catch (e: unknown)` sites that don't
/// thread the i18n function (use `stableErrorMessage` when `t` is available).
export function unknownErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (isRecord(err)) {
    const parts: string[] = [];
    if (typeof err.code === "string" && err.code.length > 0) parts.push(err.code);
    if (typeof err.message === "string" && err.message.length > 0) parts.push(err.message);
    if (parts.length > 0) return parts.join(": ");
  }
  try {
    const json = JSON.stringify(err) ?? "";
    if (json.length > 0) return json;
  } catch {
    // fall through to String()
  }
  return String(err);
}
