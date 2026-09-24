import { createHighlighter, type ThemeRegistration } from "shiki";

export type ShikiHighlighter = Awaited<ReturnType<typeof createHighlighter>>;

export const VAULT_CODE_THEME = "vault";

/**
 * Shiki theme styled by the app theme: every color is built from `var(--token)`
 * references (Shiki passes color strings through untouched), so fenced code
 * follows community presets (mocha, dracula, nord, ...) instead of a fixed
 * GitHub palette. Registered for both light and dark slots — the tokens
 * themselves already adapt, the dual-theme CSS just keeps working.
 *
 * Colors are mixed toward --foreground so every slot keeps ≥4.5:1 contrast
 * against the code background on all presets (measured incl. the light
 * latte preset; raw accent/muted tokens fail badly, e.g. accent was 1.74:1
 * on the default theme).
 */
const vaultTheme: ThemeRegistration = {
  name: VAULT_CODE_THEME,
  type: "dark",
  bg: "color-mix(in oklch, var(--muted) 55%, transparent)",
  fg: "var(--foreground)",
  settings: [
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: {
        foreground: "color-mix(in oklch, var(--muted-foreground) 55%, var(--foreground))",
      },
    },
    {
      scope: ["keyword", "storage", "keyword.operator"],
      settings: { foreground: "color-mix(in oklch, var(--primary) 65%, var(--foreground))" },
    },
    {
      scope: ["string", "string.regexp"],
      settings: { foreground: "color-mix(in oklch, var(--success) 40%, var(--foreground))" },
    },
    {
      scope: ["constant.numeric", "constant.language", "constant.character"],
      settings: { foreground: "color-mix(in oklch, var(--warning) 30%, var(--foreground))" },
    },
    {
      scope: ["entity.name.function", "entity.name.method", "support.function"],
      settings: { foreground: "color-mix(in oklch, var(--accent) 50%, var(--foreground))" },
    },
    {
      scope: ["markup.heading", "markup.bold"],
      settings: { foreground: "color-mix(in oklch, var(--primary) 65%, var(--foreground))" },
    },
  ],
};

/**
 * App-lifetime shiki singleton behind a cached promise (no module-scope
 * Solid computation — a module-level `createResource` warned
 * "never be disposed"). Each caller awaits the shared promise.
 * Shared by the file-preview highlighter and the markdown pipeline so
 * fenced code blocks reuse the same theme/languages.
 */
let highlighterPromise: Promise<ShikiHighlighter> | null = null;

export function getHighlighterPromise(): Promise<ShikiHighlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [vaultTheme],
      langs: [
        "javascript",
        "typescript",
        "tsx",
        "jsx",
        "rust",
        "python",
        "go",
        "json",
        "html",
        "css",
        "markdown",
        "sh",
        "csharp",
        "cpp",
        "c",
        "java",
        "php",
        "ruby",
        "elixir",
        "swift",
        "kotlin",
        "sql",
        "toml",
        "yaml",
        "xml",
        "docker",
        "diff",
        "lua",
        "luau",
        "plaintext",
      ],
    });
  }
  return highlighterPromise;
}
