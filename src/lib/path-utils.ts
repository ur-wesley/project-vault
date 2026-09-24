/**
 * Sync path helpers for absolute project paths (win/posix aware).
 * Single home for the trio previously copy-pasted
 * across FileTree / FilePreview / FloatingFilePreview.
 */

export function joinPathSync(parentAbs: string, name: string): string {
  const sep = parentAbs.includes("\\") ? "\\" : "/";
  const suffix = parentAbs.endsWith("/") || parentAbs.endsWith("\\") ? "" : sep;
  return `${parentAbs}${suffix}${name}`;
}

export function parentDirOf(absPath: string): string {
  const idx = Math.max(absPath.lastIndexOf("/"), absPath.lastIndexOf("\\"));
  return idx > 0 ? absPath.slice(0, idx) : absPath;
}

export function getRelativePath(abs: string, root: string): string {
  if (abs === root) return "";
  let rel = abs.substring(root.length);
  if (rel.startsWith("/") || rel.startsWith("\\")) {
    rel = rel.substring(1);
  }
  return rel.replace(/\\/g, "/");
}
