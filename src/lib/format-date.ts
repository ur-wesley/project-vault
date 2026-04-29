export function formatDate(ms: number | null | undefined, locale: string): string | null {
  if (ms == null || ms <= 0) return null;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: Date.now() - ms > 1000 * 60 * 60 * 24 * 365 ? "numeric" : undefined,
  }).format(new Date(ms));
}

export function formatRelativeTime(
  ms: number | null | undefined,
  locale: string,
): string | null {
  if (ms == null || ms <= 0) return null;

  const now = Date.now();
  const diff = now - ms;
  const sec = Math.floor(diff / 1000);
  const min = Math.floor(sec / 60);
  const hrs = Math.floor(min / 60);
  const days = Math.floor(hrs / 24);

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  if (sec < 60) return rtf.format(-sec, "second");
  if (min < 60) return rtf.format(-min, "minute");
  if (hrs < 24) return rtf.format(-hrs, "hour");
  if (days < 7) return rtf.format(-days, "day");

  return formatDate(ms, locale);
}
