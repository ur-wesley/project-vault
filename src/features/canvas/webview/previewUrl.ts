/** Normalize address-bar input the way a browser would (default to http://). */
export function normalizePreviewUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(t)) return t;
  return `http://${t}`;
}
