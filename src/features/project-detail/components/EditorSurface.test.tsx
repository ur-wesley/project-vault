// @vitest-environment happy-dom
import { okAsync } from "neverthrow";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "~/lib/i18n-context";
import { createFileTabsModel } from "../model/fileTabsModel";
import type { CodeEditorApi } from "../lib/editor-api";
import { EditorSurface } from "./EditorSurface";

vi.mock("~/services/tauri/files", () => ({
  readTextFile: (_projectId: string, _path: string) =>
    okAsync({ text: "line one\nline two\nline three\n", mtimeMs: 1, truncated: false }),
  watchProjectFiles: (_paths: readonly string[]) => okAsync(undefined),
  writeTextFile: () => okAsync({ size_bytes: 0, mtime_ms: 0, is_dir: false }),
}));

vi.mock("~/services/tauri/settings", () => ({
  getSetting: (_key: string) => okAsync(undefined),
}));

if (typeof (globalThis as any).ResizeObserver === "undefined") {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

describe("EditorSurface disposal", () => {
  it("opening a file produces no ownerless-computation warnings", async () => {
    const warns: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((...a: any[]) => {
      warns.push(String(a[0]));
    });
    try {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const apis: Record<string, CodeEditorApi> = {};
      let model!: ReturnType<typeof createFileTabsModel>;
      const dispose = render(() => {
        model ??= createFileTabsModel({ projectId: "p1", onError: () => {} });
        return (
          <I18nProvider>
            <EditorSurface
              model={model}
              activePath="test.ts"
              projectRoot="/proj"
              minimapOpen
              cursorLine={2}
              onApiReady={(path, api) => {
                apis[path] = api;
              }}
              onApiDispose={(path) => {
                delete apis[path];
              }}
              getApi={(p) => apis[p]}
              viewModeOf={() => "code"}
              onCursor={() => {}}
            />
          </I18nProvider>
        );
      }, host);
      await model.openFile("test.ts");
      await new Promise((r) => setTimeout(r, 100));
      dispose();
      host.remove();
    } finally {
      spy.mockRestore();
    }
    expect(warns.filter((w) => w.includes("never be disposed"))).toEqual([]);
  });

  it("switching tabs, toggling the minimap and closing tabs stay warning-free", async () => {
    const warns: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((...a: any[]) => {
      warns.push(String(a[0]));
    });
    try {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const apis: Record<string, CodeEditorApi> = {};
      const [activePath, setActivePath] = createSignal<string | null>("a.ts");
      const [minimapOpen, setMinimapOpen] = createSignal(true);
      let model!: ReturnType<typeof createFileTabsModel>;
      const dispose = render(() => {
        model ??= createFileTabsModel({ projectId: "p1", onError: () => {} });
        return (
          <I18nProvider>
            <EditorSurface
              model={model}
              activePath={activePath()}
              projectRoot="/proj"
              minimapOpen={minimapOpen()}
              cursorLine={2}
              onApiReady={(path, api) => {
                apis[path] = api;
              }}
              onApiDispose={(path) => {
                delete apis[path];
              }}
              getApi={(p) => apis[p]}
              viewModeOf={() => "code"}
              onCursor={() => {}}
            />
          </I18nProvider>
        );
      }, host);
      const tick = () => new Promise((r) => setTimeout(r, 50));
      await model.openFile("a.ts");
      await model.openFile("b.ts");
      await tick();
      // Switch to the second tab: mounts its minimap, unmounts the first.
      setActivePath("b.ts");
      await tick();
      // Toggle the minimap off and on while tabs are mounted.
      setMinimapOpen(false);
      await tick();
      setMinimapOpen(true);
      await tick();
      // Close the background tab, then switch back.
      model.closeTab("a.ts");
      await tick();
      setActivePath("b.ts");
      await tick();
      dispose();
      host.remove();
    } finally {
      spy.mockRestore();
    }
    expect(warns.filter((w) => w.includes("never be disposed"))).toEqual([]);
    expect(warns.filter((w) => w.includes("never be run"))).toEqual([]);
  });
});
