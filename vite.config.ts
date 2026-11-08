/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import path from "node:path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
// Ghostty WASM wiring (P1-3, ghostty-web 0.4.0 - verified, do NOT "fix"):
// The library inlines ghostty-vt.wasm (~423KB) as a base64
// `data:application/wasm` URL inside dist/ghostty-web.js and loads it via
// fetch(data:) + WebAssembly.compile (non-streaming). `Ghostty.load(path?)`
// only takes an explicit path when one is passed; bare `init()` tries the
// inline data URL first, then ./ghostty-vt.wasm and /ghostty-vt.wasm.
// Consequences:
// - No assetsInclude / ?url import / optimizeDeps.exclude is required.
//   A ?url import + Ghostty.load(url) would be WORSE under Tauri prod
//   file://: it drops the data: fallback and fetch() of a relative file URL
//   is subject to opaque-origin blocking in some WebViews, while
//   fetch(data:) always works. Verified in the bundled source, not assumed.
// - scripts/sync-ghostty-wasm.mjs (prebuild/predev) copies the same bytes to
//   public/ghostty-vt.wasm so the library's ./ and / fallbacks resolve under
//   `vite dev` and Tauri prod file:// (dist root). The wasm also ships inside
//   the content-hashed JS chunk, so a stale public copy can never go unnoticed.
// - Tauri CSP stays `csp: null` (src-tauri/tauri.conf.json): with no CSP there
//   is nothing to violate. Adding one now would require
//   `script-src 'wasm-unsafe-eval'` (WebAssembly.compile) +
//   `connect-src data:` (inline fetch) plus allowances for the Google Fonts
//   links in index.html - hardening deferred, no wildcard introduced.
export default defineConfig(async () => ({
  // solid-refresh HMR imports can't resolve under vitest — disable HMR there only.
  // @ts-expect-error process is a nodejs global
  plugins: [solid({ hot: !process.env.VITEST })],
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  resolve: {
    alias: {
      "~": path.resolve(import.meta.dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, "index.html"),
        "clipboard-overlay": path.resolve(import.meta.dirname, "clipboard-overlay.html"),
        "canvas-window": path.resolve(import.meta.dirname, "canvas-window.html"),
      },
    },
  },
}));
