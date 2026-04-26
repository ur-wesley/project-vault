import type { StableError } from "~/types/error";

export function stableErrorMessage(t: (key: string) => unknown, err: StableError): string {
  const key = `errors.${err.code}`;
  const tr = t(key);
  const generic = typeof tr === "string" && tr !== key ? tr : null;
  const detail = (err.message ?? "").trim();
  if (generic == null) return detail.length > 0 ? detail : (err.message ?? key);
  if (detail.length === 0) return generic;
  if (detail === generic || generic.includes(detail)) return generic;
  return `${generic} — ${detail}`;
}
