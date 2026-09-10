import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public/iconify");

const PREFIXES = ["mdi", "catppuccin", "devicon-plain"];

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const prefix of PREFIXES) {
  const sourcePath = join(root, `node_modules/@iconify-json/${prefix}/icons.json`);
  const raw = JSON.parse(readFileSync(sourcePath, "utf8"));
  writeFileSync(join(outDir, `${prefix}.json`), JSON.stringify(raw));
  const count = Object.keys(raw.icons ?? {}).length;
  console.log(`extract-plugin-icons: wrote ${prefix}.json (${count} icons)`);
}

console.log(`extract-plugin-icons: wrote ${PREFIXES.length} collections to public/iconify/`);
