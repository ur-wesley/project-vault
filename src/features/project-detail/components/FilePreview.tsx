import { Show, createEffect, createResource, createSignal, For, onCleanup } from "solid-js";
import { readFile, readDir, stat } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { openPath } from "@tauri-apps/plugin-opener";
import { createHighlighter } from "shiki";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { useI18n } from "~/lib/i18n-context";
import { cn } from "~/lib/utils";
import { formatBytes } from "~/lib/format-bytes";
import { FileIcon } from "~/components/FileIcon";
import {
  getFileExtension,
  getPreviewMediaKind,
  getPreviewMimeType,
  PREVIEW_MEDIA_MAX_BYTES,
} from "~/lib/preview-media";

const [highlighter] = createResource(async () => {
  return await createHighlighter({
    themes: ["github-dark"],
    langs: [
      "javascript",
      "typescript",
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
});

const EXT_LANG_MAP: Record<string, string> = {
  cs: "csharp",
  rs: "rust",
  py: "python",
  js: "javascript",
  ts: "typescript",
  tsx: "typescript",
  jsx: "javascript",
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

export function FilePreview(props: {
  path: string | null;
  projectRoot?: string;
  scrollToLine?: number;
  onBackToResults?: () => void;
  backLabel?: string;
  onNavigate?: (path: string) => void;
}) {
  const { t } = useI18n();
  const [viewMode, setViewMode] = createSignal<"preview" | "code">("preview");

  createEffect(() => {
    const _path = props.path;
    setViewMode("preview");
  });

  const [content] = createResource(
    () => props.path,
    async (path): Promise<FilePreviewContent | null> => {
      if (!path) return null;
      try {
        const info = await stat(path);
        if (info.isDirectory) {
          const list = await readDir(path);
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
          const filtered = list.filter((e) => !SKIP.has(e.name));

          const childPromises = filtered.map(async (entry) => {
            const childPath = await join(path, entry.name);
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

        const filename = path.split(/[\\/]/).pop()?.toLowerCase() || "";
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

          const bytes = await readFile(path);
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

        const bytes = await readFile(path);
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

        const extMatch = filename.match(/\.([^.]+)$/);
        const ext = extMatch ? extMatch[1] : "";
        const isMarkdown = filename.endsWith(".md") || filename.endsWith(".markdown");

        let markdownHtml = "";
        if (isMarkdown) {
          try {
            const parsed = await marked.parse(text);
            markdownHtml = DOMPurify.sanitize(parsed);
          } catch (err) {
            console.error("Failed to parse markdown:", err);
          }
        }

        let lang =
          FILENAME_LANG_MAP[filename] || EXT_LANG_MAP[ext] || (ext.length > 0 ? ext : "plaintext");

        const hl = highlighter();
        if (hl) {
          const supported = hl.getLoadedLanguages();
          if (!supported.includes(lang)) {
            lang = "plaintext";
          }

          const html = hl.codeToHtml(text, {
            lang,
            theme: "github-dark",
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
    },
  );

  const [lastScrolledLine, setLastScrolledLine] = createSignal(0);

  const getRelativePath = (abs: string, root: string) => {
    if (abs === root) return "";
    let rel = abs.substring(root.length);
    if (rel.startsWith("/") || rel.startsWith("\\")) {
      rel = rel.substring(1);
    }
    return rel.replace(/\\/g, "/");
  };

  const breadcrumbs = () => {
    const p = props.path;
    const root = props.projectRoot;
    if (!p || !root) return [];

    const rel = getRelativePath(p, root);
    if (!rel) return [];

    const parts = rel.split("/");
    const result: Array<{ name: string; absPath: string }> = [];
    let currentAccum = root;

    for (const part of parts) {
      if (!part) continue;
      const separator = root.includes("\\") ? "\\" : "/";
      currentAccum = currentAccum.endsWith(separator) ? currentAccum + part : currentAccum + separator + part;
      result.push({ name: part, absPath: currentAccum });
    }
    return result;
  };

  createEffect(() => {
    const c = content();
    const url = c?.mediaUrl;
    onCleanup(() => {
      if (url) URL.revokeObjectURL(url);
    });
  });

  const onOpenExternally = async () => {
    const path = props.path;
    if (!path) return;
    try {
      await openPath(path);
    } catch (e) {
      console.error("Failed to open file externally:", e);
    }
  };

  createEffect(() => {
    const line = props.scrollToLine ?? 0;
    const c = content();
    if (!line || line <= 0 || !c || !c.html) return;
    if (lastScrolledLine() === line) return;

    setLastScrolledLine(line);

    setTimeout(() => {
      const container = document.querySelector(".shiki-container");
      if (!container) return;
      const el = container.querySelector(`[data-line="${line}"]`);
      if (el) {
        el.classList.add("search-highlight-line");
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => {
          el.classList.remove("search-highlight-line");
        }, 3000);
      }
    }, 120);
  });

  return (
    <div class="h-full flex flex-col min-w-0 bg-card/50 rounded-md border border-border/40 overflow-hidden">
      <Show
        when={content() && content()!.isDirectory}
        fallback={
          <>
            <div class="flex items-center justify-between px-3 py-1.5 bg-muted/20 border-b border-border/40 shrink-0 gap-3">
              <div class="flex items-center gap-2 min-w-0">
                <Show when={props.onBackToResults}>
                  <Tooltip>
                    <TooltipTrigger
                      as="button"
                      type="button"
                      class="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
                      onClick={props.onBackToResults}
                    >
                      <span class="iconify mdi--arrow-left h-3.5 w-3.5" />
                    </TooltipTrigger>
                    <TooltipContent>{props.backLabel ?? (t("projectDetail.searchResults") as string)}</TooltipContent>
                  </Tooltip>
                </Show>
                <FileIcon
                  name={props.path?.split(/[\\/]/).pop() ?? ""}
                  class="h-3.5 w-3.5"
                />
                <span class="text-[10px] font-mono text-muted-foreground truncate">
                  {props.path?.split(/[\\/]/).pop() ?? (t("projectDetail.noFileSelected") as string)}
                </span>
              </div>
              
              <div class="flex items-center gap-2 shrink-0">
                <Show when={content() && content()!.isMarkdown}>
                  <div class="flex items-center bg-muted/40 rounded-md p-0.5 border border-border/10">
                    <button
                      type="button"
                      class={cn(
                        "px-2 py-0.5 rounded text-[10px] font-semibold transition-all cursor-pointer",
                        viewMode() === "preview"
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                      onClick={() => setViewMode("preview")}
                    >
                      Preview
                    </button>
                    <button
                      type="button"
                      class={cn(
                        "px-2 py-0.5 rounded text-[10px] font-semibold transition-all cursor-pointer",
                        viewMode() === "code"
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                      onClick={() => setViewMode("code")}
                    >
                      Code
                    </button>
                  </div>
                </Show>

                <Show when={content() && content()!.loc > 0}>
                  <span class="text-[9px] font-mono text-muted-foreground/60 uppercase tracking-wider">
                    {t("projectDetail.fileLines", { count: content()!.loc }) as string}
                  </span>
                </Show>
                <Show when={content()?.fileSize != null && content()?.mediaKind}>
                  <span class="text-[9px] font-mono text-muted-foreground/60 uppercase tracking-wider">
                    {formatBytes(content()!.fileSize!)}
                  </span>
                </Show>
              </div>
            </div>
            <div
              class={cn(
                "flex-1 min-h-0",
                content()?.mediaKind === "pdf" ? "overflow-hidden" : "overflow-auto",
              )}
            >
              <Show
                when={content()}
                fallback={
                  <div class="p-3 text-muted-foreground italic text-[11px] font-mono">{t("projectDetail.selectFilePreview") as string}</div>
                }
              >
                {(c) => (
                  <Show
                    when={c().mediaTooLarge}
                    fallback={
                      <Show
                        when={c().mediaKind === "image" && c().mediaUrl}
                        fallback={
                          <Show
                            when={c().mediaKind === "pdf" && c().mediaUrl}
                            fallback={
                              <Show
                                when={c().isMarkdown && viewMode() === "preview"}
                                fallback={
                                  <div class="text-[11px] font-mono">
                                    <Show when={c().html} fallback={<pre class="p-3 whitespace-pre-wrap">{c().text}</pre>}>
                                      <div class="shiki-container" innerHTML={c().html!} />
                                    </Show>
                                  </div>
                                }
                              >
                                <div class="pv-github-readme mx-auto w-full max-w-3xl pt-2 pb-6 px-4">
                                  <article class="markdown-body !bg-transparent" innerHTML={c().markdownHtml!} />
                                </div>
                              </Show>
                            }
                          >
                            <embed
                              src={c().mediaUrl!}
                              type="application/pdf"
                              class="w-full h-full min-h-0"
                            />
                          </Show>
                        }
                      >
                        <div class="flex h-full min-h-0 items-center justify-center p-4">
                          <img
                            src={c().mediaUrl!}
                            alt=""
                            class="max-h-full max-w-full object-contain"
                          />
                        </div>
                      </Show>
                    }
                  >
                    <div class="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
                      <p class="text-[11px] text-muted-foreground">
                        {t("projectDetail.fileMediaTooLarge", {
                          size: formatBytes(c().fileSize ?? 0),
                        }) as string}
                      </p>
                      <button
                        type="button"
                        class="rounded-md border border-border/40 bg-muted/30 px-3 py-1.5 text-[11px] font-medium text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
                        onClick={onOpenExternally}
                      >
                        {t("projectDetail.openExternally") as string}
                      </button>
                    </div>
                  </Show>
                )}
              </Show>
            </div>
          </>
        }
      >
        <div class="p-6 h-full overflow-auto flex flex-col min-w-0 font-sans text-xs">
          {/* Header Section */}
          <div class="flex items-center gap-3 mb-6 shrink-0 border-b border-border/40 pb-4">
            <div class="size-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-500">
              <FileIcon
                name={props.path?.split(/[\\/]/).pop() ?? ""}
                isDirectory
                class="h-6 w-6"
              />
            </div>
            <div class="flex flex-col min-w-0">
              <h3 class="text-sm font-semibold text-foreground/90 truncate">
                {props.path?.split(/[\\/]/).pop()}
              </h3>
              {/* Breadcrumbs */}
              <div class="flex items-center gap-1.5 text-[11px] text-muted-foreground/60 overflow-x-auto whitespace-nowrap mt-0.5 scrollbar-none">
                <button
                  type="button"
                  class="hover:text-primary hover:underline font-medium cursor-pointer"
                  onClick={() => props.onNavigate?.(props.projectRoot || "")}
                >
                  {props.projectRoot?.split(/[\\/]/).pop() || "Root"}
                </button>
                <For each={breadcrumbs()}>
                  {(crumb) => (
                    <>
                      <span class="iconify mdi--chevron-right h-3 w-3 shrink-0" />
                      <button
                        type="button"
                        class="hover:text-primary hover:underline font-medium truncate max-w-[120px] cursor-pointer"
                        onClick={() => props.onNavigate?.(crumb.absPath)}
                      >
                        {crumb.name}
                      </button>
                    </>
                  )}
                </For>
              </div>
            </div>
          </div>

          {/* Directory Contents */}
          <div class="flex-1 overflow-y-auto rounded-md border border-border/40 bg-muted/5 p-1 min-h-0">
            <table class="w-full text-left text-xs border-collapse">
              <thead>
                <tr class="border-b border-border/40 text-[10px] text-muted-foreground/60 font-semibold tracking-wider uppercase">
                  <th class="py-2 px-3">{t("projectDetail.taskEditor.name") || "Name"}</th>
                  <th class="py-2 px-3">{t("common.status") || "Type"}</th>
                  <th class="py-2 px-3 text-right">{t("locations.sizeColumn") || "Size"}</th>
                </tr>
              </thead>
              <tbody>
                <Show when={content() && content()!.children?.length === 0}>
                  <tr>
                    <td colspan={3} class="py-12 text-center text-muted-foreground italic">
                      {t("projectDetail.dirEmpty") || "This directory is empty."}
                    </td>
                  </tr>
                </Show>
                <Show when={content()}>
                  <For each={content()!.children}>
                    {(child) => {
                      const extMatch = child.name.match(/\.([^.]+)$/);
                      const typeLabel = child.isDirectory
                        ? (t("projectDetail.isDirectory") || "Folder")
                        : extMatch
                        ? `${extMatch[1]!.toUpperCase()} File`
                        : "File";

                      return (
                        <tr
                          class="group hover:bg-primary/5 hover:text-primary rounded cursor-pointer transition-all duration-150 border-b border-border/10 last:border-b-0"
                          onClick={() => props.onNavigate?.(child.absPath)}
                        >
                          <td class="py-2.5 px-3 font-mono text-[11px] font-medium flex items-center gap-2 max-w-xs truncate">
                            <FileIcon
                              name={child.name}
                              isDirectory={child.isDirectory}
                              class="size-4 transition-transform group-hover:scale-110"
                            />
                            <span class="truncate">{child.name}</span>
                          </td>
                          <td class="py-2.5 px-3 text-muted-foreground/80 group-hover:text-primary/80 font-mono text-[10px]">
                            {typeLabel}
                          </td>
                          <td class="py-2.5 px-3 text-right font-mono text-[10px] text-muted-foreground/60 group-hover:text-primary/60">
                            {child.isDirectory ? "—" : formatBytes(child.size)}
                          </td>
                        </tr>
                      );
                    }}
                  </For>
                </Show>
              </tbody>
            </table>
          </div>
        </div>
      </Show>
    </div>
  );
}
