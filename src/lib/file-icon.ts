import { getIconClassList } from "atom-file-icons";
import { iconToSVG } from "@iconify/utils";

export type FileIconData = {
  body: string;
  width?: number;
  height?: number;
};

export const FOLDER_SENTINEL = "__folder__";

const cache = new Map<string, FileIconData>();
const pending = new Map<string, Promise<FileIconData | null>>();

const FILE_FALLBACK = "default";

const ATOM_CLASS_TO_ICONIFY: Record<string, string> = {
  "json-icon": "json-1",
  "markdown-icon": "rmarkdown",
  "book-icon": "rmarkdown",
  "git-icon": "magit",
  "github-icon": "gitlab",
  "node-icon": "nodemon",
  "config-ts-icon": "config-typescript",
  "package-icon": "toml",
  "icon-file-text": "default",
  "ts-icon": "typescript",
  "js-icon": "config-js",
  "rust-icon": "config-rust",
  "python-icon": "config-python",
  "react-icon": "config-react",
  "go-icon": "config-go",
  "ruby-icon": "config-ruby",
  "csharp-icon": "csharp",
  "fsharp-icon": "fsharp",
  "vs-icon": "vscode",
  "csscript-icon": "csharp",
};

const STRIPPED_NAME_OVERRIDES: Record<string, string> = {
  ts: "typescript",
  js: "config-js",
  rust: "config-rust",
  package: "toml",
  python: "config-python",
  react: "config-react",
  go: "config-go",
  ruby: "config-ruby",
};

const FILENAME_TO_ICON: Record<string, string> = {
  "package.json": "npm",
  ".gitignore": "magit",
  ".gitattributes": "magit",
  ".gitmodules": "magit",
  ".gitconfig": "magit",
};

const EXTENSION_TO_ICON: Record<string, string> = {
  ".luau": "lua",
  ".md": "rmarkdown",
  ".json": "json-1",
  ".cs": "csharp",
  ".csx": "csharp",
  ".fs": "fsharp",
  ".csproj": "vscode",
  ".sln": "vscode",
};

function basename(name: string): string {
  return name.split(/[/\\]/).pop() ?? name;
}

function resolveByFilenameRules(name: string): string | null {
  const key = basename(name).toLowerCase();
  return FILENAME_TO_ICON[key] ?? null;
}

function resolveByExtensionRules(name: string): string | null {
  const base = basename(name).toLowerCase();
  for (const [ext, icon] of Object.entries(EXTENSION_TO_ICON)) {
    if (base.endsWith(ext)) return icon;
  }
  return null;
}

function pickAtomIconClass(classes: string[] | null): string | undefined {
  if (!classes?.length) return undefined;
  const specific = classes.find((c) => c.endsWith("-icon"));
  if (specific) return specific;
  const fileFallback = classes.find(
    (c) => c.startsWith("icon-file-") && c !== "icon-file-directory",
  );
  if (fileFallback) return fileFallback;
  return classes.find((c) => c === "icon-file-directory");
}

function isGenericAtomClass(iconClass: string | undefined): boolean {
  return (
    iconClass === undefined ||
    iconClass === "icon-file-text" ||
    iconClass === "icon-file-directory"
  );
}

function atomClassToIconifyName(iconClass: string): string {
  const mapped = ATOM_CLASS_TO_ICONIFY[iconClass];
  if (mapped) return mapped;
  if (iconClass.endsWith("-icon")) {
    const stripped = iconClass.slice(0, -5);
    return STRIPPED_NAME_OVERRIDES[stripped] ?? stripped;
  }
  if (iconClass === "icon-file-text") return FILE_FALLBACK;
  return iconClass;
}

export function fileIconifyName(name: string, isDirectory = false): string {
  const filenameRule = resolveByFilenameRules(name);
  if (filenameRule) return filenameRule;

  const classes = getIconClassList(name, { isDir: isDirectory, colorMode: "mono" });
  const iconClass = pickAtomIconClass(classes);

  if (!isDirectory) {
    const extensionRule = resolveByExtensionRules(name);
    if (extensionRule && isGenericAtomClass(iconClass)) {
      return extensionRule;
    }
  }

  if (!iconClass) return isDirectory ? FOLDER_SENTINEL : FILE_FALLBACK;
  if (iconClass === "icon-file-directory") return FOLDER_SENTINEL;

  return atomClassToIconifyName(iconClass);
}

async function fetchIconData(iconName: string): Promise<FileIconData | null> {
  const res = await fetch(`/file-icons/${iconName}.json`);
  if (!res.ok) return null;
  return (await res.json()) as FileIconData;
}

async function loadIconByName(iconName: string): Promise<FileIconData | null> {
  if (cache.has(iconName)) return cache.get(iconName)!;

  const inFlight = pending.get(iconName);
  if (inFlight) return inFlight;

  const promise = fetchIconData(iconName)
    .then((data) => {
      if (data) cache.set(iconName, data);
      return data;
    })
    .finally(() => {
      pending.delete(iconName);
    });

  pending.set(iconName, promise);
  return promise;
}

export async function loadFileIcon(name: string, isDirectory = false): Promise<FileIconData | null> {
  const iconName = fileIconifyName(name, isDirectory);
  if (iconName === FOLDER_SENTINEL) return null;

  const loaded = await loadIconByName(iconName);
  if (loaded) return loaded;

  if (!isDirectory && iconName !== FILE_FALLBACK) {
    return loadIconByName(FILE_FALLBACK);
  }

  return null;
}

export function iconToSvgString(icon: FileIconData, size = "1em"): string {
  const rendered = iconToSVG(icon, { height: size });
  const attrs = rendered.attributes as Record<string, string>;
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, "&quot;")}"`)
    .join(" ");
  return `<svg ${attrStr}>${rendered.body}</svg>`;
}
