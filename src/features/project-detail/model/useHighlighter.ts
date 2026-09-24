import { createResource } from "solid-js";

import { getHighlighterPromise, type ShikiHighlighter } from "~/services/code-highlighter";

export type { ShikiHighlighter };

const EXT_LANG_MAP: Record<string, string> = {
  cs: "csharp",
  rs: "rust",
  py: "python",
  js: "javascript",
  ts: "typescript",
  tsx: "tsx",
  jsx: "jsx",
  rb: "ruby",
  ex: "elixir",
  exs: "elixir",
  sh: "sh",
  bash: "sh",
  yml: "yaml",
  gradle: "kotlin",
  kts: "kotlin",
  lua: "lua",
  luau: "luau",
};

const FILENAME_LANG_MAP: Record<string, string> = {
  dockerfile: "docker",
  makefile: "sh",
  gemfile: "ruby",
  rakefile: "ruby",
  procfile: "yaml",
  "cmakelists.txt": "cpp",
  ".gitignore": "plaintext",
  ".env": "sh",
};

/**
 * App-lifetime shiki singleton lives in ~/services/code-highlighter so the
 * markdown pipeline can share it (no module-scope Solid computation — a
 * module-level `createResource` warned "never be disposed"). Each caller
 * creates its own lightweight resource over the shared promise.
 * (Extracted from FilePreview.)
 */
export function useHighlighter() {
  const [highlighter] = createResource(getHighlighterPromise);
  return highlighter;
}

export function resolvePreviewLang(filename: string): string {
  const lower = filename.toLowerCase();
  const extMatch = lower.match(/\.([^.]+)$/);
  const ext = extMatch ? extMatch[1] : "";
  return FILENAME_LANG_MAP[lower] || EXT_LANG_MAP[ext] || (ext.length > 0 ? ext : "plaintext");
}
