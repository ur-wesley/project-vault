// File-size budgets: TS warn 300 / fail 600, Rust warn 400 / fail 800,
// Luau warn 300 / fail 600. Warnings never fail; any fail-level file exits 1.
// Usage: node scripts/check-file-budget.mjs
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const RULES = [
  {
    label: "TS",
    dir: "src",
    exts: [".ts", ".tsx"],
    warn: 300,
    fail: 600,
    // i18n dictionaries, colocated tests, and generated env declarations are exempt.
    exclude: [/^src\/messages\//, /\.test\.[cm]?[jt]sx?$/, /vite-env\.d\.ts$/],
  },
  {
    label: "Rust",
    dir: join("src-tauri", "src"),
    exts: [".rs"],
    warn: 400,
    fail: 800,
    exclude: [],
  },
  {
    label: "Luau",
    dir: "pv-plugins",
    exts: [".luau", ".lua"],
    warn: 300,
    fail: 600,
    // vault.luau is a generated copy of src-tauri/lua-sdk/vault.luau (see gen:sdk).
    exclude: [/(^|\/)vault\.luau$/],
  },
];

const SKIP_DIRS = new Set([
  "node_modules",
  "target",
  "dist",
  ".git",
  "gen",
  "icons",
  "graphify-out",
]);

function walk(dir, exts, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), exts, out);
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

function countLines(path) {
  return readFileSync(path, "utf8").split("\n").length;
}

let failures = 0;
let warnings = 0;
const rows = [];

for (const rule of RULES) {
  const absDir = join(root, rule.dir);
  if (!existsSync(absDir)) continue;
  for (const file of walk(absDir, rule.exts, [])) {
    const rel = relative(root, file).split(sep).join("/");
    if (rule.exclude.some((re) => re.test(rel))) continue;
    const lines = countLines(file);
    if (lines > rule.fail) {
      failures += 1;
      rows.push({ sev: "FAIL", lines, rel });
    } else if (lines > rule.warn) {
      warnings += 1;
      rows.push({ sev: "warn", lines, rel });
    }
  }
}

rows.sort((a, b) => b.lines - a.lines);
for (const r of rows)
  console.log(`${r.sev === "FAIL" ? "FAIL" : "warn"} ${String(r.lines).padStart(5)}  ${r.rel}`);
console.log(`\nbudget: ${failures} over fail-line, ${warnings} over warn-line`);
process.exit(failures > 0 ? 1 : 0);
