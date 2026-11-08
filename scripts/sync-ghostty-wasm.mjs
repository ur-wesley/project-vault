import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// ghostty-web ships the compiled VT parser next to the package root
// (see "exports": { "./ghostty-vt.wasm": ... } in its package.json).
const candidates = [
  join(root, "node_modules/ghostty-web/ghostty-vt.wasm"),
  join(root, "node_modules/ghostty-web/dist/ghostty-vt.wasm"),
];
const outFile = join(root, "public/ghostty-vt.wasm");

const source = candidates.find((p) => existsSync(p));
if (!source) {
  console.error(`sync-ghostty-wasm: no ghostty-vt.wasm found in ${candidates.join(" or ")}`);
  process.exit(1);
}
const size = statSync(source).size;
if (size === 0) {
  console.error(`sync-ghostty-wasm: refusing to copy empty WASM from ${source}`);
  process.exit(1);
}
mkdirSync(dirname(outFile), { recursive: true });
copyFileSync(source, outFile);
console.log(`sync-ghostty-wasm: copied ${size} bytes (${source}) to public/ghostty-vt.wasm`);
