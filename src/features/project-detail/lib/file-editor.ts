import type { Extension } from "@codemirror/state";
import { StreamLanguage, type LanguageSupport, type StreamParser } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { go } from "@codemirror/lang-go";
import { java } from "@codemirror/lang-java";
import { cpp } from "@codemirror/lang-cpp";
import { php } from "@codemirror/lang-php";
import { sql } from "@codemirror/lang-sql";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { xml } from "@codemirror/lang-xml";

import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";

type LanguageFactory = () => LanguageSupport | Extension;

function stream(parser: StreamParser<unknown>): Extension {
  return StreamLanguage.define(parser);
}

const EXTENSION_LANGUAGES: Record<string, LanguageFactory> = {
  js: () => javascript(),
  mjs: () => javascript(),
  cjs: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  ts: () => javascript({ typescript: true }),
  mts: () => javascript({ typescript: true }),
  cts: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  py: () => python(),
  pyi: () => python(),
  rs: () => rust(),
  go: () => go(),
  java: () => java(),
  c: () => cpp(),
  h: () => cpp(),
  cc: () => cpp(),
  cpp: () => cpp(),
  cxx: () => cpp(),
  hpp: () => cpp(),
  hh: () => cpp(),
  php: () => php(),
  sql: () => sql(),
  html: () => html(),
  htm: () => html(),
  vue: () => html(),
  svelte: () => html(),
  css: () => css(),
  scss: () => css(),
  less: () => css(),
  json: () => json(),
  jsonc: () => json(),
  json5: () => json(),
  md: () => markdown(),
  markdown: () => markdown(),
  mdx: () => markdown(),
  yaml: () => yaml(),
  yml: () => yaml(),
  xml: () => xml(),
  svg: () => xml(),
  xsl: () => xml(),
  plist: () => xml(),
  sh: () => stream(shell),
  bash: () => stream(shell),
  zsh: () => stream(shell),
  fish: () => stream(shell),
  toml: () => stream(toml),
  lua: () => stream(lua),
  luau: () => stream(lua),
  diff: () => stream(diff),
  patch: () => stream(diff),
};

/** Exact filename matches take priority over the extension map. */
const FILENAME_LANGUAGES: Record<string, LanguageFactory> = {
  dockerfile: () => stream(dockerFile),
  containerfile: () => stream(dockerFile),
  makefile: () => stream(shell),
  procfile: () => yaml(),
  "cmakelists.txt": () => cpp(),
  ".env": () => stream(shell),
};

const NON_TEXT_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "icns",
  "tiff",
  "avif",
  "pdf",
  "zip",
  "gz",
  "tar",
  "tgz",
  "bz2",
  "xz",
  "7z",
  "rar",
  "jar",
  "exe",
  "dll",
  "so",
  "dylib",
  "bin",
  "wasm",
  "class",
  "o",
  "a",
  "lib",
  "pdb",
  "mp3",
  "mp4",
  "mov",
  "avi",
  "mkv",
  "wav",
  "ogg",
  "flac",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "sqlite",
  "db",
  "snap",
]);

/** Backend read cap. Files above this open read-only instead of in the editor. */
export const EDITOR_TOO_LARGE_BYTES = 8 * 1024 * 1024;

/**
 * Resolve CodeMirror language support for a file name. Returns an empty
 * extension list for unknown types so the file still opens as plain text.
 */
export function resolveEditorLanguage(fileName: string): Extension {
  const lower = fileName.toLowerCase();
  const byName = FILENAME_LANGUAGES[lower];
  if (byName) return byName();

  const dot = lower.lastIndexOf(".");
  if (dot < 0) return [];
  const factory = EXTENSION_LANGUAGES[lower.slice(dot + 1)];
  return factory ? factory() : [];
}

function extensionOf(fileName: string): string {
  const lower = fileName.toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot >= 0 ? lower.slice(dot + 1) : "";
}

/** Short language tag shown in the editor toolbar. */
export function languageLabel(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (FILENAME_LANGUAGES[lower]) return lower;
  return extensionOf(fileName) || "text";
}

export type PreviewKind = "markdown" | "html";

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdx"]);
const HTML_EXTENSIONS = new Set(["html", "htm"]);

/**
 * Renderable preview kind for an editable file, or null when the editor is
 * the only view. Images/PDFs are intentionally absent: they open read-only
 * and already preview via FilePreview.
 */
export function previewKindOf(fileName: string): PreviewKind | null {
  const ext = extensionOf(fileName);
  if (MARKDOWN_EXTENSIONS.has(ext)) return "markdown";
  if (HTML_EXTENSIONS.has(ext)) return "html";
  return null;
}

/** A file is safe to open in the editor when it is text and within the cap. */
export function isProbablyEditable(fileName: string, sizeBytes: number): boolean {
  if (sizeBytes > EDITOR_TOO_LARGE_BYTES) return false;
  return !NON_TEXT_EXTENSIONS.has(extensionOf(fileName));
}
