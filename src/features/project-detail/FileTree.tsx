import { readDir, readFile, type DirEntry } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { For, Show, createEffect, createSignal, createResource } from "solid-js";
import { createHighlighter } from "shiki";
import { cn } from "~/lib/utils";

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

function sortEntries(a: DirEntry, b: DirEntry): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function Folder(props: {
  absPath: string;
  label: string;
  depth: number;
  onFileClick: (path: string) => void;
  selectedPath: string | null;
}) {
  const [open, setOpen] = createSignal(props.depth < 1);
  const [items, setItems] = createSignal<DirEntry[]>([]);
  const [loadErr, setLoadErr] = createSignal<string | null>(null);

  createEffect(() => {
    if (!open()) return;
    void (async () => {
      try {
        const list = await readDir(props.absPath);
        setItems(list.filter((e) => !SKIP.has(e.name)).sort(sortEntries));
        setLoadErr(null);
      } catch (e) {
        setLoadErr(String(e));
        setItems([]);
      }
    })();
  });

  return (
    <div class="font-mono text-[11px]">
      <div
        class="flex items-center gap-1 py-0.5 hover:bg-muted/30 cursor-pointer"
        style={{ "padding-left": `${props.depth * 12}px` }}
        onClick={() => setOpen(!open())}
      >
        <span
          class={cn(
            "size-4 flex items-center justify-center text-muted-foreground transition-transform",
            open() && "rotate-90",
          )}
        >
          <span class="iconify mdi--chevron-right h-3 w-3" />
        </span>
        <span class="iconify mdi--folder h-3.5 w-3.5 text-blue-400/80" />
        <span class="min-w-0 truncate text-foreground/90">{props.label}</span>
        <Show when={loadErr()}>
          <span class="truncate text-destructive">({loadErr()})</span>
        </Show>
      </div>
      <Show when={open()}>
        <For each={items()}>
          {(e) => (
            <Show
              when={e.isDirectory}
              fallback={
                <FileItem
                  parentAbs={props.absPath}
                  name={e.name}
                  depth={props.depth + 1}
                  onClick={props.onFileClick}
                  selected={props.selectedPath}
                />
              }
            >
              <FileTreeFolderFromParent
                parentAbs={props.absPath}
                name={e.name}
                depth={props.depth + 1}
                onFileClick={props.onFileClick}
                selectedPath={props.selectedPath}
              />
            </Show>
          )}
        </For>
      </Show>
    </div>
  );
}

function FileItem(props: {
  parentAbs: string;
  name: string;
  depth: number;
  onClick: (path: string) => void;
  selected: string | null;
}) {
  const [absPath, setAbsPath] = createSignal<string | undefined>();
  createEffect(() => {
    void join(props.parentAbs, props.name).then((p) => setAbsPath(p));
  });

  const isSelected = () => absPath() === props.selected;

  return (
    <div
      class={cn(
        "flex items-center gap-1.5 py-0.5 pr-2 cursor-pointer transition-colors",
        isSelected()
          ? "bg-primary/15 text-primary"
          : "hover:bg-muted/50 text-foreground/70 hover:text-foreground",
      )}
      style={{ "padding-left": `${props.depth * 12 + 16}px` }}
      onClick={() => absPath() && props.onClick(absPath()!)}
    >
      <span class="iconify mdi--file-outline h-3.5 w-3.5 shrink-0 opacity-60" />
      <span class="truncate">{props.name}</span>
    </div>
  );
}

function FileTreeFolderFromParent(props: {
  parentAbs: string;
  name: string;
  depth: number;
  onFileClick: (path: string) => void;
  selectedPath: string | null;
}) {
  const [absPath, setAbsPath] = createSignal<string | undefined>();
  createEffect(() => {
    void join(props.parentAbs, props.name).then((p) => setAbsPath(p));
  });
  return (
    <Show when={absPath()}>
      {(p) => (
        <Folder
          absPath={p()}
          label={props.name}
          depth={props.depth}
          onFileClick={props.onFileClick}
          selectedPath={props.selectedPath}
        />
      )}
    </Show>
  );
}

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

function FilePreview(props: { path: string | null }) {
  const [content] = createResource(
    () => props.path,
    async (path) => {
      if (!path) return null;
      try {
        const bytes = await readFile(path);
        const text = new TextDecoder().decode(bytes);

        // Robust binary check: check for null bytes or excessive non-printable chars
        const isBinary =
          text.includes("\0") ||
          text
            .slice(0, 1024)
            .split("")
            .filter((c) => {
              const code = c.charCodeAt(0);
              // Allow tab (9), LF (10), CR (13)
              return code < 32 && code !== 9 && code !== 10 && code !== 13;
            }).length > 10;

        if (isBinary || text.includes("\ufffd")) {
          return { text: "[Binary File]", html: null, loc: 0 };
        }

        const lines = text.split(/\r?\n/);
        const loc = lines.length;

        if (text.length > 100000) {
          return { text: text.slice(0, 100000) + "\n\n[Truncated...]", html: null, loc };
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

  return (
    <div class="h-full flex flex-col min-w-0 bg-card/50 rounded-md border border-border/40 overflow-hidden">
      <div class="flex items-center justify-between px-3 py-1.5 bg-muted/20 border-b border-border/40 shrink-0">
        <div class="flex items-center gap-2 min-w-0">
          <span class="iconify mdi--file-document h-3.5 w-3.5 text-muted-foreground" />
          <span class="text-[10px] font-mono text-muted-foreground truncate">
            {props.path?.split(/[\\/]/).pop() ?? "No file selected"}
          </span>
        </div>
        <Show when={content() && content()!.loc > 0}>
          <span class="text-[9px] font-mono text-muted-foreground/60 uppercase tracking-wider">
            {content()!.loc} lines
          </span>
        </Show>
      </div>
      <div class="flex-1 overflow-auto text-[11px] font-mono">
        <Show
          when={content()}
          fallback={<div class="p-3 text-muted-foreground italic">Select a file to preview</div>}
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

export function FileTree(props: { rootPath: string }) {
  const [selectedPath, setSelectedPath] = createSignal<string | null>(null);

  const label = () => {
    const s = props.rootPath.replace(/\\/g, "/").replace(/\/+$/, "");
    const i = s.lastIndexOf("/");
    return i >= 0 ? s.slice(i + 1) : s;
  };

  return (
    <div class="flex h-full min-h-0 gap-4 overflow-hidden">
      <div class="w-64 shrink-0 overflow-auto rounded-md border border-border/60 bg-muted/20 p-2 scrollbar-none">
        <Folder
          absPath={props.rootPath}
          label={label()}
          depth={0}
          onFileClick={setSelectedPath}
          selectedPath={selectedPath()}
        />
      </div>
      <div class="flex-1 min-w-0 h-full overflow-hidden">
        <FilePreview path={selectedPath()} />
      </div>
    </div>
  );
}
