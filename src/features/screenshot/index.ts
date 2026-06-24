import { createSignal } from "solid-js";
import { toast } from "solid-sonner";
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

      try {
        if (source.type === "all-screens") {
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
          // Capture + selection in one call (fast: raw RGBA, no JPEG round-trip)
          const resultR = await screenshotService.selectRegion();

          if (resultR.isErr()) {
            toast.error(t("screenshot.captureFailed", { message: resultR.error.message }));
            return;
          }
          if (!resultR.value) return; // cancelled

          // Zero-dimension result = copied to clipboard or saved to file
          if (resultR.value.width === 0 || resultR.value.height === 0) {
            toast.success(t("screenshot.copied"));
            return;
          }

          // Crop the selected region from the returned image
          const cropped = await screenshotService.cropImage(
            resultR.value.imageBase64,
            { x: resultR.value.x, y: resultR.value.y, width: resultR.value.width, height: resultR.value.height },
            resultR.value.imageWidth,
            resultR.value.imageHeight,
          );
          setImageData(cropped);
          setAppState("editing");
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
