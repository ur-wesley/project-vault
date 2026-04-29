export function formatWorktime(ms: number): string {
  if (ms <= 0) return "—";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  if (m > 0) {
    return `${m}:${s.toString().padStart(2, "0")}`;
  }
  return `${s}s`;
}

export function formatSessionRange(
  started: number,
  ended: number | null,
  t: (k: string) => unknown,
): string {
  const locale = document.documentElement.lang || "en";
  const dtf = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const s = dtf.format(new Date(started));
  if (ended == null) return `${s} · ${t("library.sessionOpen") as string}`;
  const e = dtf.format(new Date(ended));
  const dur = formatDuration(ended - started);
  return `${s} → ${e} (${dur})`;
}
