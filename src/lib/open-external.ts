import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

import { asString } from "./guards";

/**
 * Allowlist for external URLs (P0-2, OQ-5 DECIDED 2026-11-08):
 * terminal link text flows into the OS handler, so only
 * `http:`, `https:`, `mailto:`, `tel:` may pass — matching the
 * markdown sink (`EXTERNAL_HREF_RE` in `services/markdown.ts`).
 * Case-insensitive after trim; protocol-relative (`//host`) and
 * leading-whitespace/control-char tricks are rejected outright
 * (padded URLs are blocked, not trimmed-then-allowed).
 */
const ALLOWED_EXTERNAL_RE = /^(https?:\/\/|mailto:|tel:)/i;

/** Leading whitespace or control chars: padded or smuggled-scheme URLs. */
const LEADING_JUNK_RE = /^[\s\p{Cc}]/u;

/**
 * Single-home gate (no-duplicate rule): both terminal link sinks
 * (`TerminalHost`, `task-stream-dialog`) and the `window.open`
 * shim below route through this check.
 */
export function isAllowedExternalHref(value: unknown): boolean {
  const raw = asString(value);
  if (!raw || LEADING_JUNK_RE.test(raw)) return false;
  const href = raw.trim();
  if (href.startsWith("//")) return false;
  return ALLOWED_EXTERNAL_RE.test(href);
}

if (isTauri() && typeof window !== "undefined") {
  const originalOpen = window.open.bind(window);
  window.open = (url?: string | URL, target?: string, features?: string) => {
    const href = typeof url === "string" ? url : url?.toString();
    if (href != null && isAllowedExternalHref(href)) {
      void openUrl(href.trim());
      return null;
    }
    return originalOpen(url, target, features);
  };
}

/**
 * Open an external URL in the system browser (Tauri `openUrl`)
 * or a new tab (web fallback). Non-allowlisted schemes are a
 * no-op plus `console.warn` (warn-only: link text is untrusted
 * terminal output, not an app error).
 */
export async function openExternal(href: string): Promise<void> {
  const raw = asString(href);
  if (!isAllowedExternalHref(raw)) {
    console.warn(`[openExternal] blocked non-allowlisted URL: ${raw.trim().slice(0, 64)}`);
    return;
  }
  const target = raw.trim();
  if (isTauri()) {
    await openUrl(target);
    return;
  }
  window.open(target, "_blank", "noopener,noreferrer");
}
