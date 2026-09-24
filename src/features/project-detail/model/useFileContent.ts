import { createResource, createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import { readFile, readDir, stat } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";

import type { useI18n } from "~/lib/i18n-context";
import { renderMarkdownHtml } from "~/services/markdown";
import { VAULT_CODE_THEME } from "~/services/code-highlighter";
import {
  getFileExtension,
  getPreviewMediaKind,
  getPreviewMimeType,
  PREVIEW_MEDIA_MAX_BYTES,
} from "~/lib/preview-media";
import { resolvePreviewLang, useHighlighter } from "./useHighlighter";

type T = ReturnType<typeof useI18n>["t"];

export type FilePreviewContent = {
  text: string;
  html: string | null;
  loc: number;
  isDirectory?: boolean;
  isMarkdown?: boolean;
  markdownHtml?: string;
  mediaKind?: "image" | "pdf";
  mediaUrl?: string;
  fileSize?: number;
  mediaTooLarge?: boolean;
  children?: Array<{
    name: string;
    isDirectory: boolean;
    size: number;
    absPath: string;
  }>;
};

const SKIP = new Set([
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

/**
 * File-content domain: loads stat/dir-listing/media/text + highlight for
 * the given path, owns the preview/code view mode (reset on path change).
 * (Extracted verbatim from FilePreview.)
 */
export function createFileContentModel(opts: { path: Accessor<string | null>; t: T }) {
  const { path, t } = opts;
  const [viewMode, setViewMode] = createSignal<"preview" | "code">("preview");
  const highlighter = useHighlighter();

  const [content] = createResource(path, async (p): Promise<FilePreviewContent | null> => {
    // Reset to rendered preview whenever the file itself changes.
    setViewMode("preview");
    if (!p) return null;
    try {
      const info = await stat(p);
      if (info.isDirectory) {
        const list = await readDir(p);
        const filtered = list.filter((e) => !SKIP.has(e.name));

        const childPromises = filtered.map(async (entry) => {
          const childPath = await join(p, entry.name);
          let size = 0;
          if (entry.isFile) {
            try {
              const childInfo = await stat(childPath);
              size = childInfo.size;
            } catch {
              // ignore
            }
          }
          return {
            name: entry.name,
            isDirectory: entry.isDirectory,
            size,
            absPath: childPath,
          };
        });

        const children = await Promise.all(childPromises);
        children.sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) {
            return a.isDirectory ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });

        return {
          text: "",
          html: null,
          loc: 0,
          isDirectory: true,
          children,
        };
      }

      const filename = p.split(/[\\/]/).pop()?.toLowerCase() || "";
      const mediaKind = getPreviewMediaKind(filename);

      if (mediaKind) {
        const fileSize = info.size;
        if (fileSize > PREVIEW_MEDIA_MAX_BYTES) {
          return {
            text: "",
            html: null,
            loc: 0,
            mediaKind,
            fileSize,
            mediaTooLarge: true,
          };
        }

        const bytes = await readFile(p);
        const ext = getFileExtension(filename);
        const mime = getPreviewMimeType(ext);
        const blob = new Blob([bytes], { type: mime });
        const mediaUrl = URL.createObjectURL(blob);

        return {
          text: "",
          html: null,
          loc: 0,
          mediaKind,
          mediaUrl,
          fileSize,
        };
      }

      const bytes = await readFile(p);
      const text = new TextDecoder().decode(bytes);

      const isBinary =
        text.includes("\0") ||
        text
          .slice(0, 1024)
          .split("")
          .filter((c) => {
            const code = c.charCodeAt(0);
            return code < 32 && code !== 9 && code !== 10 && code !== 13;
          }).length > 10;

      if (isBinary || text.includes("\ufffd")) {
        return { text: t("projectDetail.fileBinary") as string, html: null, loc: 0 };
      }

      const lines = text.split(/\r?\n/);
      const loc = lines.length;

      if (text.length > 100000) {
        return {
          text: text.slice(0, 100000) + "\n\n" + (t("projectDetail.fileTruncated") as string),
          html: null,
          loc,
        };
      }

      const isMarkdown = filename.endsWith(".md") || filename.endsWith(".markdown");

      let markdownHtml = "";
      if (isMarkdown) {
        try {
          markdownHtml = await renderMarkdownHtml(text);
        } catch (err) {
          console.error("Failed to parse markdown:", err);
        }
      }

      let lang = resolvePreviewLang(filename);

      const hl = highlighter();
      if (hl) {
        const supported = hl.getLoadedLanguages();
        if (!supported.includes(lang)) {
          lang = "plaintext";
        }

        const html = hl.codeToHtml(text, {
          lang,
          // Same token-var theme in both slots: vars resolve against the
          // active app/community theme, so code follows presets automatically.
          themes: { light: VAULT_CODE_THEME, dark: VAULT_CODE_THEME },
          // Emit CSS variables only (--shiki-light/--shiki-dark) instead of
          // inline light-theme colors, so the dual-theme CSS in
          // src/styles/markdown-theme.css can switch palettes with app dark mode.
          defaultColor: false,
          transformers: [
            {
              line(node, line) {
                node.properties["data-line"] = line;
              },
            },
          ],
        });
        return { text, html, loc, isMarkdown, markdownHtml };
      }

      return { text, html: null, loc, isMarkdown, markdownHtml };
    } catch (e) {
      return { text: String(e), html: null, loc: 0 };
    }
  });

  return { content, viewMode, setViewMode };
}

export type FileContentModel = ReturnType<typeof createFileContentModel>;
