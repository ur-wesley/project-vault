export function pathBasename(p: string): string {
  const n = p.replace(/[/\\]+$/, "");
  const i = Math.max(n.lastIndexOf("/"), n.lastIndexOf("\\"));
  return i >= 0 ? n.slice(i + 1) : n;
}

export function joinParentName(parent: string, name: string): string {
  const sep = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
  return `${parent.replace(/[/\\]+$/, "")}${sep}${name}`;
}

function pathsEqual(a: string, b: string): boolean {
  const n = (s: string) =>
    s
      .replace(/[/\\]+$/, "")
      .replace(/[/\\]+/g, "/")
      .toLowerCase();
  return n(a) === n(b);
}

export function isSameProjectDestination(
  locRoot: string,
  projectPath: string,
  projectFolderName: string,
): boolean {
  return pathsEqual(joinParentName(locRoot, projectFolderName), projectPath);
}
