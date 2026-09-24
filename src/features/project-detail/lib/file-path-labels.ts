/** Display helpers for absolute project paths. */

export function baseNameOfPath(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] ?? filePath;
}

export function relativeToRoot(root: string, abs: string): string {
  if (!root || !abs.startsWith(root)) return abs;
  let rel = abs.slice(root.length);
  if (rel.startsWith("/") || rel.startsWith("\\")) rel = rel.slice(1);
  return rel.replace(/\\/g, "/");
}
