import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { availableMonitors } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { ClipboardOverlayPositionDto } from "~/types/dto";
import { getClipboardOverlayPosition } from "~/services/tauri/clipboard-history";
import { CLIPBOARD_PANEL_HEIGHT, CLIPBOARD_PANEL_WIDTH } from "./panel-layout";

const panelSize = () => new LogicalSize(CLIPBOARD_PANEL_WIDTH, CLIPBOARD_PANEL_HEIGHT);

async function fallbackOverlayLayout(): Promise<ClipboardOverlayPositionDto> {
  try {
    const monitors = await availableMonitors();
    const monitor = monitors[0];
    if (!monitor) throw new Error("no monitors");

    const scale = monitor.scaleFactor || 1;
    const panelWPhys = Math.round(CLIPBOARD_PANEL_WIDTH * scale);
    const panelHPhys = Math.round(CLIPBOARD_PANEL_HEIGHT * scale);

    return {
      windowX: monitor.position.x + Math.round((monitor.size.width - panelWPhys) / 2),
      windowY: monitor.position.y + Math.round((monitor.size.height - panelHPhys) / 2),
      windowWidth: CLIPBOARD_PANEL_WIDTH,
      windowHeight: CLIPBOARD_PANEL_HEIGHT,
    };
  } catch {
    return {
      windowX: Math.round((1920 - CLIPBOARD_PANEL_WIDTH) / 2),
      windowY: Math.round((1080 - CLIPBOARD_PANEL_HEIGHT) / 2),
      windowWidth: CLIPBOARD_PANEL_WIDTH,
      windowHeight: CLIPBOARD_PANEL_HEIGHT,
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

  const win = new WebviewWindow("clipboard-overlay", {
    url: "/clipboard-overlay.html",
    title: "Clipboard History",
    width: CLIPBOARD_PANEL_WIDTH,
    height: CLIPBOARD_PANEL_HEIGHT,
    decorations: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    shadow: false,
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

  const size = panelSize();
  await win.setPosition(new PhysicalPosition(layout.windowX, layout.windowY));
  await win.setSize(size);
  await win.setMinSize(size);
  await win.setMaxSize(size);

  await win.show();
  await win.setShadow(true);
  await win.setFocus();
}
