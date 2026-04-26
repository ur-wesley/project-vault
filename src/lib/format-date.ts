export function formatRelativeTime(ms: number | null | undefined): string | null {
  if (ms == null || ms <= 0) return null;

  const now = Date.now();
  const diff = now - ms;
  const sec = Math.floor(diff / 1000);
  const min = Math.floor(sec / 60);
  const hrs = Math.floor(min / 60);
  const days = Math.floor(hrs / 24);

  if (sec < 60) return "just now";
  if (min < 60) return `${min}m ago`;
  if (hrs < 24) return `${hrs}h ago`;
  if (days < 7) return `${days}d ago`;

  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: now - ms > 1000 * 60 * 60 * 24 * 365 ? "numeric" : undefined,
  });
}
