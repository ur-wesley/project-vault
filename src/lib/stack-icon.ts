const STACK_TO_ICON: Record<string, string> = {
  javascript: "javascript",
  typescript: "typescript",
  python: "python",
  rust: "rust",
  cargo: "rust",
  go: "go",
  dotnet: "csharp",
  csharp: "csharp",
  deno: "deno",
  php: "php",
  ruby: "ruby",
  elixir: "elixir",
  kotlin: "kotlin",
  java: "java",
  swift: "swift",
  cpp: "cpp",
  node: "javascript",
  nodejs: "javascript",
  nodedotjs: "javascript",
  "node-js": "javascript",
  bun: "bun",
  npm: "npm",
  yarn: "yarn",
  pnpm: "pnpm",
  composer: "composer",
  maven: "maven",
  gradle: "gradle",
  git: "git",
  github: "github",
  monorepo: "folder-node",
};

export function stackCatppuccinIconName(stack: string): string {
  const k = stack.trim().toLowerCase();
  return STACK_TO_ICON[k] ?? "text";
}

export function stackIconifyClass(stack: string): string {
  return `iconify catppuccin--${stackCatppuccinIconName(stack)}`;
}
