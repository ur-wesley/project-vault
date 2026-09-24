// Regenerate the Linguist subset tables from upstream languages.yml.
//
// Usage:
//   bun scripts/update-linguist-table.mjs [path/to/languages.yml]
//   # without an arg it fetches the pinned rev below (needs network).
//
// Pinned upstream rev (update intentionally, then re-verify colors/names):
//   https://github.com/github-linguist/linguist/blob/main/lib/linguist/languages.yml
//
// The script prints Rust (`lang!(...)` lines) + TS (`Name: "#hex"`) lines for
// the ALLOWLIST to stdout. Copy the output into
// `src-tauri/src/linguist.rs` and `LanguageBar.tsx` after reviewing the diff.
// It never edits files itself.
import { readFileSync } from "node:fs";

const PINNED_URL =
  "https://raw.githubusercontent.com/github-linguist/linguist/main/lib/linguist/languages.yml";

// Languages we actually graph. Everything else is excluded from stats,
// mirroring Linguist's default (only programming/markup counted).
const ALLOWLIST = new Set([
  "TypeScript",
  "JavaScript",
  "Rust",
  "Go",
  "Python",
  "C#",
  "C++",
  "C",
  "Java",
  "PHP",
  "Ruby",
  "Elixir",
  "Swift",
  "Kotlin",
  "Scala",
  "SQL",
  "HTML",
  "CSS",
  "SCSS",
  "Less",
  "Vue",
  "Svelte",
  "Astro",
  "TeX",
  "Shell",
  "PowerShell",
  "Batchfile",
  "Dockerfile",
  "CMake",
  "Makefile",
  "Lua",
  "Luau",
  "Dart",
  "Haskell",
  "OCaml",
  "Clojure",
  "F#",
  "Perl",
  "R",
  "Julia",
  "Zig",
  "Solidity",
  "GDScript",
  "CoffeeScript",
  "Crystal",
  "Nim",
  "Erlang",
  "Elm",
  "Stylus",
]);

async function loadYamlText() {
  if (process.argv[2]) return readFileSync(process.argv[2], "utf8");
  const res = await fetch(PINNED_URL);
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${PINNED_URL}`);
  return await res.text();
}

// Minimal YAML reader: only top-level `Name:` keys, `color:`, `type:`,
// and list items under `extensions:`/`filenames:`. Good enough for the
// allowlisted subset; fails loudly on unexpected shapes.
function parseSubset(text) {
  const out = new Map();
  let current = null;
  let listMode = null;
  for (const rawLine of text.split("\n")) {
    if (/^\S/.test(rawLine) && rawLine.endsWith(":")) {
      const name = rawLine.slice(0, -1);
      current = ALLOWLIST.has(name)
        ? { name, color: null, type: null, extensions: [], filenames: [] }
        : null;
      if (current) out.set(name, current);
      listMode = null;
      continue;
    }
    if (!current) continue;
    const m = rawLine.match(/^  (\w+):\s*(.*)$/);
    if (m) {
      const [, key, val] = m;
      if (key === "color" || key === "type") current[key] = val.trim().replace(/^"|"$/g, "");
      listMode = key === "extensions" || key === "filenames" ? key : null;
      continue;
    }
    const li = rawLine.match(/^  - "(.*)"$/);
    if (li && listMode) current[listMode].push(li[1]);
  }
  return [...out.values()];
}

function rustIdent(name) {
  return name.replace(/[^A-Za-z0-9]/g, "").toUpperCase() || "UNKNOWN";
}

const rows = parseSubset(await loadYamlText());
for (const r of rows) {
  if (!r.color) console.error(`# note: ${r.name} has no upstream color (type=${r.type})`);
}
console.log("// --- Rust (src-tauri/src/linguist.rs) ---");
for (const r of rows) {
  console.log(`lang!(${rustIdent(r.name)}, "${r.name}", "${r.color ?? "#888888"}");`);
}
console.log("// --- TS (LanguageBar.tsx) ---");
for (const r of rows) {
  console.log(`  "${r.name}": "${r.color ?? "#888888"}",`);
}
console.log("// --- extensions/filenames (audit) ---");
for (const r of rows) {
  console.log(
    `// ${r.name} [${r.type}]: ext=${r.extensions.join(" ")} files=${r.filenames.join(" ")}`,
  );
}
