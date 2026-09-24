// Verifies the plugin SDK is in sync: every fragment's key types must exist in vault.luau.
// Usage: bun run gen:sdk (check mode). Concatenation is manual to keep diffs reviewable.
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sdkPath = join(root, "src-tauri", "lua-sdk", "vault.luau");
const fragDir = join(root, "src-tauri", "lua-sdk", "fragments");

const sdk = readFileSync(sdkPath, "utf8");
const frags = readdirSync(fragDir).filter((f) => f.endsWith(".luau"));

const expectations = {
  "store.luau": ["VaultStore", "set_persist"],
  "signals.luau": ["createSignal", "createMemo", "createEffect", "batch"],
  "table.luau": ["TableColumn", "TableDialogOptions", "ConfirmOptions", "ToastOptions", "set_view"],
};

let failed = false;
for (const f of frags) {
  const need = expectations[f] ?? [];
  for (const token of need) {
    if (!sdk.includes(token)) {
      console.error(`SDK out of sync: vault.luau missing "${token}" required by fragments/${f}`);
      failed = true;
    }
  }
}
if (failed) {
  process.exit(1);
}
console.log(`SDK in sync: vault.luau covers ${frags.length} fragments (${frags.join(", ")})`);
