import { Show, createEffect, createResource, createSignal } from "solid-js";
import { readFile } from "@tauri-apps/plugin-fs";
import { createHighlighter } from "shiki";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { useI18n } from "~/lib/i18n-context";

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

export function FilePreview(props: {
  path: string | null;
  scrollToLine?: number;
  onBackToResults?: () => void;
  backLabel?: string;
}) {
  const { t } = useI18n();
  const [content] = createResource(
    () => props.path,
    async (path) => {
      if (!path) return null;
      try {
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

        const filename = path.split(/[\\/]/).pop()?.toLowerCase() || "";
        const extMatch = filename.match(/\.([^.]+)$/);
        const ext = extMatch ? extMatch[1] : "";

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
          return { text, html, loc };
        }

        return { text, html: null, loc };
      } catch (e) {
        return { text: String(e), html: null, loc: 0 };
      }
    },
  );

  const [lastScrolledLine, setLastScrolledLine] = createSignal(0);

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
          <span class="iconify mdi--file-document h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span class="text-[10px] font-mono text-muted-foreground truncate">
            {props.path?.split(/[\\/]/).pop() ?? (t("projectDetail.noFileSelected") as string)}
          </span>
        </div>
        <Show when={content() && content()!.loc > 0}>
          <span class="text-[9px] font-mono text-muted-foreground/60 uppercase tracking-wider shrink-0">
            {t("projectDetail.fileLines", { count: content()!.loc }) as string}
          </span>
        </Show>
      </div>
      <div class="flex-1 overflow-auto text-[11px] font-mono">
        <Show
          when={content()}
          fallback={
            <div class="p-3 text-muted-foreground italic">{t("projectDetail.selectFilePreview") as string}</div>
          }
        >
          {(c) => (
            <Show when={c().html} fallback={<pre class="p-3 whitespace-pre-wrap">{c().text}</pre>}>
              <div class="shiki-container" innerHTML={c().html!} />
            </Show>
          )}
        </Show>
      </div>
    </div>
  );
}
