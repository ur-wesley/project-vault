import { createSignal } from "solid-js";
import { toast } from "solid-sonner";
import { listen, emitTo } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import * as screenshotService from "~/services/tauri/screenshot";
import { getSetting } from "~/services/tauri/settings";
import type { ScreenInfoDto, WindowInfoDto } from "~/types/dto";
import type { CaptureSource } from "./components/SourceSelector";

type AppState = "closed" | "selecting" | "editing";

const [appState, setAppState] = createSignal<AppState>("closed");
const [imageData, setImageData] = createSignal<Uint8Array | null>(null);
const [saveDirectory, setSaveDirectory] = createSignal<string | null>(null);
const [screens, setScreens] = createSignal<ScreenInfoDto[]>([]);
const [windows, setWindows] = createSignal<WindowInfoDto[]>([]);

function generateFilename(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `screenshot-${date}-${time}.png`;
}

async function loadSaveDirectory() {
  const r = await getSetting("screenshot_save_dir");
  if (r.isOk() && r.value) {
    setSaveDirectory(r.value);
  }
}

/**
 * Open the overlay window for region selection.
 * The screenshot must already be captured (blocking) before calling this.
 */
function openOverlayWindow(
  capturedBase64: string,
  strings: Record<string, string>,
  imageWidth: number,
  imageHeight: number,
): Promise<Uint8Array | null> {
  return new Promise(async (resolve) => {
    let settled = false;
    const settle = (result: Uint8Array | null) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    // Get monitor bounds
    const monitors = await screenshotService.getAllMonitorBounds();
    const bounds = screenshotService.computeDesktopBounds(monitors);

    // Create window — use fullscreen first (guaranteed to cover primary monitor)
    const win = new WebviewWindow("screenshot-overlay", {
      url: "/screenshot-overlay.html",
      decorations: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      focus: true,
      fullscreen: true,
      visible: false,
    });

    // After window is ready, try to expand to cover all monitors
    let expandPromise: Promise<void> | null = null;
    const tryExpand = (): Promise<void> => {
      if (expandPromise) return expandPromise;
      expandPromise = (async () => {
        try {
          await win.setFullscreen(false);
          // Small delay for the fullscreen exit to take effect
          await new Promise((r) => setTimeout(r, 50));
          // Use logical dimensions for setSize/setPosition
          await win.setSize({
            type: "Logical",
            width: bounds.logicalWidth,
            height: bounds.logicalHeight,
          } as never);
          await win.setPosition({
            type: "Logical",
            x: bounds.logicalX,
            y: bounds.logicalY,
          } as never);
        } catch (e) {
          console.error("[screenshot] Multi-monitor expansion failed:", e);
        }
      })();
      return expandPromise;
    };

    // Register listeners BEFORE creating the window
    const unlistenReady = await listen("screenshot-overlay:ready", () => {
      // Send strings, image, and image dimensions TO the overlay window
      void emitTo("screenshot-overlay", "screenshot-overlay:load-strings", { strings });
      void emitTo("screenshot-overlay", "screenshot-overlay:load-image", {
        base64: capturedBase64,
        imageWidth,
        imageHeight,
      });
      // Start expanding in the background immediately!
      void tryExpand();
    });

    const unlistenResult = await listen<{ base64: string }>(
      "screenshot-overlay:result",
      (event) => {
        settle(screenshotService.base64ToUint8Array(event.payload.base64));
      },
    );

    const unlistenCopy = await listen<{ base64: string }>(
      "screenshot-overlay:copy",
      async (event) => {
        const data = screenshotService.base64ToUint8Array(event.payload.base64);
        try {
          await screenshotService.copyPngToClipboard(data);
          toast.success("Copied to clipboard");
        } catch (e) {
          toast.error(`Failed to copy: ${String(e)}`);
        }
        settle(null);
      },
    );

    const unlistenCancel = await listen("screenshot-overlay:cancel", () => {
      settle(null);
    });

    const unlistenShow = await listen("screenshot-overlay:show", async () => {
      // Ensure multi-monitor expansion is fully completed before showing the window
      await tryExpand();
      await new Promise((r) => setTimeout(r, 50));
      await win.show();
      await win.setFocus();
    });

    // If window closed without sending result
    try {
      await win.onCloseRequested(() => {
        settle(null);
      });
    } catch {
      // ignore
    }

    // Cleanup after resolution
    const cleanup = () => {
      unlistenReady();
      unlistenResult();
      unlistenCopy();
      unlistenCancel();
      unlistenShow();
    };
    void Promise.race([
      new Promise<void>((r) => {
        const check = () => (settled ? r() : setTimeout(check, 100));
        check();
      }),
      new Promise<void>((r) => setTimeout(r, 300_000)),
    ]).then(cleanup);
  });
}

export function useScreenshot() {
  return {
    appState,
    imageData,
    saveDirectory,
    screens,
    windows,

    async openSelector(t: (key: string, args?: Record<string, unknown>) => string) {
      try {
        await loadSaveDirectory();
        const [screensR, windowsR] = await Promise.all([
          screenshotService.listScreens(),
          screenshotService.listWindows(),
        ]);
        if (screensR.isErr()) {
          toast.error(t("screenshot.listFailed", { message: screensR.error.message }));
          return;
        }
        if (windowsR.isOk()) {
          setWindows(windowsR.value);
        }
        setScreens(screensR.value);
        setAppState("selecting");
      } catch (e) {
        toast.error(t("screenshot.captureFailed", { message: String(e) }));
      }
    },

    async selectSource(source: CaptureSource, t: (key: string, args?: Record<string, unknown>) => string) {
      setAppState("closed");

      // Collect translated strings for the overlay
      const strings: Record<string, string> = {};
      for (const key of [
        "screenshot.selectRegionHint",
        "screenshot.cancel",
        "screenshot.save",
        "screenshot.copyToClipboard",
        "screenshot.reset",
        "screenshot.annotate",
        "screenshot.toolSelect",
        "screenshot.toolArrow",
        "screenshot.toolRectangle",
        "screenshot.toolDraw",
        "screenshot.toolHighlight",
      ]) {
        strings[key] = t(key);
      }

      try {
        if (source.type === "all-screens") {
          // Capture all screens and go directly to annotation editor
          const captureR = await screenshotService.captureAllScreens();
          if (captureR.isErr()) {
            toast.error(t("screenshot.captureFailed", { message: captureR.error.message }));
            return;
          }
          setImageData(screenshotService.base64ToUint8Array(captureR.value));
          setAppState("editing");
          return;
        }

        if (source.type === "region") {
          // Capture FIRST (blocking), then open window with image ready
          const captureR = await screenshotService.captureAllScreens();
          if (captureR.isErr()) {
            toast.error(t("screenshot.captureFailed", { message: captureR.error.message }));
            return;
          }

          // Get image dimensions from the Rust side
          const monitors = await screenshotService.getAllMonitorBounds();
          const bounds = screenshotService.computeDesktopBounds(monitors);

          const cropped = await openOverlayWindow(
            captureR.value,
            strings,
            bounds.physicalWidth,
            bounds.physicalHeight,
          );
          if (cropped) {
            setImageData(cropped);
            setAppState("editing");
          }
          return;
        }

        let captureR;
        if (source.type === "screen") {
          captureR = await screenshotService.captureScreen(source.monitorId);
        } else if (source.type === "window") {
          captureR = await screenshotService.captureWindow(source.windowId);
        }

        if (!captureR) return;
        if (captureR.isErr()) {
          toast.error(t("screenshot.captureFailed", { message: captureR.error.message }));
          return;
        }
        setImageData(screenshotService.base64ToUint8Array(captureR.value));
        setAppState("editing");
      } catch (e) {
        toast.error(t("screenshot.captureFailed", { message: String(e) }));
      }
    },

    close() {
      setAppState("closed");
      setImageData(null);
    },

    async save(data: Uint8Array, t: (key: string, args?: Record<string, unknown>) => string) {
      let dir = saveDirectory();
      if (!dir) {
        const picked = await screenshotService.pickScreenshotDirectory();
        if (picked.isErr() || !picked.value) return;
        dir = picked.value;
        setSaveDirectory(dir);
      }
      const filename = generateFilename();
      const sep = dir.includes("/") ? "/" : "\\";
      const path = `${dir}${sep}${filename}`;
      const r = await screenshotService.saveScreenshot(path, Array.from(data));
      if (r.isErr()) {
        toast.error(t("screenshot.saveFailed", { message: r.error.message }));
        return;
      }
      toast.success(t("screenshot.saved", { path: r.value }));
      setAppState("closed");
      setImageData(null);
    },

    async copyToClipboard(data: Uint8Array, t: (key: string, args?: Record<string, unknown>) => string) {
      try {
        await screenshotService.copyPngToClipboard(data);
        toast.success(t("screenshot.copied"));
        setAppState("closed");
        setImageData(null);
      } catch (e) {
        toast.error(t("screenshot.copyFailed", { message: String(e) }));
      }
    },
  };
}
