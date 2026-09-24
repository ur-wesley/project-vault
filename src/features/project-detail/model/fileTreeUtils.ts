import { readDir, type DirEntry } from "@tauri-apps/plugin-fs";

import { joinPathSync } from "~/lib/path-utils";

/** Directory names never shown in the tree. (Moved verbatim from FileTree.) */
export const SKIP = new Set([
  "node_modules",
  ".git",
  "target",
  "dist",
  "build",
  ".turbo",
  ".next",
  ".nuxt",
  "__pycache__",
  ".venv",
  "venv",
  "vendor",
  ".idea",
  ".vs",
  "coverage",
  ".cache",
  "out",
  "bin",
  "obj",
]);

export function sortEntries(a: DirEntry, b: DirEntry): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
  return a.name.localeCompare(b.name);
}

export function sameEntries(a: DirEntry[], b: DirEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.name !== y.name || x.isDirectory !== y.isDirectory || x.isFile !== y.isFile) return false;
  }
  return true;
}

export const recursiveCountCache = new Map<string, number>();

export async function countFilesRecursively(absPath: string): Promise<number> {
  let count = 0;
  try {
    const entries = await readDir(absPath);
    for (const entry of entries) {
      if (SKIP.has(entry.name)) continue;
      if (entry.isDirectory) {
        count += await countFilesRecursively(joinPathSync(absPath, entry.name));
      } else {
        count += 1;
      }
    }
  } catch {
    // ignore unreadable dirs
  }
  return count;
}
