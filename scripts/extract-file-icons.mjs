import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(root, "node_modules/@iconify-json/file-icons/icons.json");
const supplementPath = join(
  root,
  "node_modules/@iconify-json/devicon-plain/icons.json",
);
const outDir = join(root, "public/file-icons");

const raw = JSON.parse(readFileSync(sourcePath, "utf8"));
const defaultWidth = raw.width ?? 512;
const defaultHeight = raw.height ?? 512;

const SUPPLEMENTAL_ICON_NAMES = ["csharp", "fsharp"];

function writeIconPayload(outName, icon, width, height) {
  const payload = {
    body: icon.body,
    width: icon.width ?? width,
    height: icon.height ?? height,
  };
  writeFileSync(join(outDir, `${outName}.json`), JSON.stringify(payload));
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const names = Object.keys(raw.icons);
for (const name of names) {
  writeIconPayload(name, raw.icons[name], defaultWidth, defaultHeight);
}

const supplement = JSON.parse(readFileSync(supplementPath, "utf8"));
const supplementWidth = supplement.width ?? 128;
const supplementHeight = supplement.height ?? 128;
for (const name of SUPPLEMENTAL_ICON_NAMES) {
  const icon = supplement.icons[name];
  if (!icon) {
    console.warn(`extract-file-icons: missing supplemental icon ${name}`);
    continue;
  }
  writeIconPayload(name, icon, supplementWidth, supplementHeight);
  if (!names.includes(name)) names.push(name);
}

writeFileSync(join(outDir, "_manifest.json"), JSON.stringify(names));
console.log(
  `extract-file-icons: wrote ${names.length} icons (${SUPPLEMENTAL_ICON_NAMES.length} supplemental) to public/file-icons/`,
);
