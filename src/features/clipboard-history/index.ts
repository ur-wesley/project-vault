import { availableMonitors } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { ClipboardOverlayPositionDto } from "~/types/dto";
import { getClipboardOverlayPosition } from "~/services/tauri/clipboard-history";
import { CLIPBOARD_PANEL_HEIGHT, CLIPBOARD_PANEL_WIDTH } from "./panel-layout";

async function fallbackOverlayLayout(): Promise<ClipboardOverlayPositionDto> {
  try {
    const monitors = await availableMonitors();
    const monitor = monitors[0];
    if (!monitor) throw new Error("no monitors");

    const scale = monitor.scaleFactor || 1;
    const windowX = Math.round(monitor.position.x / scale);
    const windowY = Math.round(monitor.position.y / scale);
    const windowWidth = Math.round(monitor.size.width / scale);
    const windowHeight = Math.round(monitor.size.height / scale);

    return {
      windowX,
      windowY,
      windowWidth,
      windowHeight,
      panelX: Math.round((windowWidth - CLIPBOARD_PANEL_WIDTH) / 2),
      panelY: Math.round((windowHeight - CLIPBOARD_PANEL_HEIGHT) / 2),
    };
  } catch {
    return {
      windowX: 0,
      windowY: 0,
      windowWidth: 1920,
      windowHeight: 1080,
      panelX: Math.round((1920 - CLIPBOARD_PANEL_WIDTH) / 2),
      panelY: Math.round((1080 - CLIPBOARD_PANEL_HEIGHT) / 2),
    };
  }
}

export async function openClipboardOverlay(): Promise<void> {
  const existing = await WebviewWindow.getByLabel("clipboard-overlay");
  if (existing) {
    await existing.destroy();
  }

  const posResult = await getClipboardOverlayPosition(
    CLIPBOARD_PANEL_WIDTH,
    CLIPBOARD_PANEL_HEIGHT,
  );
  const layout = posResult.isOk() ? posResult.value : await fallbackOverlayLayout();

  const params = new URLSearchParams({
    panelX: String(layout.panelX),
    panelY: String(layout.panelY),
  });

  const win = new WebviewWindow("clipboard-overlay", {
    url: `/clipboard-overlay.html?${params.toString()}`,
    title: "Clipboard History",
    width: layout.windowWidth,
    height: layout.windowHeight,
    x: layout.windowX,
    y: layout.windowY,
    decorations: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    resizable: false,
    focus: false,
    visible: false,
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("overlay window timeout")), 10000);
    void win.once("tauri://created", () => {
      clearTimeout(timeout);
      resolve();
    });
    void win.once("tauri://error", (e) => {
      clearTimeout(timeout);
      reject(e);
    });
  });

  await win.setPosition({
    type: "Logical",
    x: layout.windowX,
    y: layout.windowY,
  } as never);
  await win.setSize({
    type: "Logical",
    width: layout.windowWidth,
    height: layout.windowHeight,
  } as never);

  await win.show();
  await win.setFocus();
}
