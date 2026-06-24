import type { ScreenInfoDto, WindowInfoDto } from "~/types/dto";
import { tauriInvoke } from "./utils";
import { availableMonitors } from "@tauri-apps/api/window";

export function listScreens() {
  return tauriInvoke<ScreenInfoDto[]>("list_screens");
}

export function listWindows() {
  return tauriInvoke<WindowInfoDto[]>("list_windows");
}

export function getDesktopBounds() {
  return tauriInvoke<{ x: number; y: number; width: number; height: number }>("get_desktop_bounds");
}

export function captureScreen(monitorId: number) {
  return tauriInvoke<string>("capture_screen", { monitorId });
}

export function captureAllScreens() {
  return tauriInvoke<string>("capture_all_screens");
}

export function captureWindow(windowId: number) {
  return tauriInvoke<string>("capture_window", { windowId });
}

export function captureRegion(
  monitorId: number,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  return tauriInvoke<string>("capture_region", {
    monitorId,
    x,
    y,
    width,
    height,
  });
}

export function saveScreenshot(path: string, data: number[]) {
  return tauriInvoke<string>("save_screenshot", { path, data });
}

export function pickScreenshotDirectory() {
  return tauriInvoke<string | null>("pick_screenshot_directory");
}

export interface SelectionDto {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RegionSelectionResultDto {
  x: number;
  y: number;
  width: number;
  height: number;
  imageBase64: string;
  imageWidth: number;
  imageHeight: number;
}

export function selectRegion() {
  return tauriInvoke<RegionSelectionResultDto | null>("select_region");
}

import { writeImageBase64 } from "tauri-plugin-clipboard-api";

function uint8ArrayToBase64(arr: Uint8Array): string {
  let binary = "";
  const len = arr.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(arr[i]);
  }
  return btoa(binary);
}

export async function copyPngToClipboard(data: Uint8Array): Promise<void> {
  const base64 = uint8ArrayToBase64(data);
  await writeImageBase64(base64);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export interface MonitorBounds {
  /** Physical pixel position/size from the OS */
  physicalX: number;
  physicalY: number;
  physicalWidth: number;
  physicalHeight: number;
  /** Logical pixel position/size (physical / scaleFactor) */
  logicalX: number;
  logicalY: number;
  logicalWidth: number;
  logicalHeight: number;
  scaleFactor: number;
}

export async function getAllMonitorBounds(): Promise<MonitorBounds[]> {
  try {
    const monitors = await availableMonitors();
    return monitors.map((m) => {
      const sf = m.scaleFactor || 1;
      return {
        physicalX: m.position.x,
        physicalY: m.position.y,
        physicalWidth: m.size.width,
        physicalHeight: m.size.height,
        logicalX: Math.round(m.position.x / sf),
        logicalY: Math.round(m.position.y / sf),
        logicalWidth: Math.round(m.size.width / sf),
        logicalHeight: Math.round(m.size.height / sf),
        scaleFactor: sf,
      };
    });
  } catch {
    return [];
  }
}

/** Compute the bounding box of all monitors in both physical and logical pixels */
export function computeDesktopBounds(monitors: MonitorBounds[]): {
  physicalX: number; physicalY: number; physicalWidth: number; physicalHeight: number;
  logicalX: number; logicalY: number; logicalWidth: number; logicalHeight: number;
  scaleFactor: number;
} {
  if (monitors.length === 0) {
    return { physicalX: 0, physicalY: 0, physicalWidth: 1920, physicalHeight: 1080, logicalX: 0, logicalY: 0, logicalWidth: 1920, logicalHeight: 1080, scaleFactor: 1 };
  }
  let minPX = Infinity, minPY = Infinity, maxPX = -Infinity, maxPY = -Infinity;
  let minLX = Infinity, minLY = Infinity, maxLX = -Infinity, maxLY = -Infinity;
  const sf = monitors[0].scaleFactor;
  for (const m of monitors) {
    if (m.physicalX < minPX) minPX = m.physicalX;
    if (m.physicalY < minPY) minPY = m.physicalY;
    if (m.physicalX + m.physicalWidth > maxPX) maxPX = m.physicalX + m.physicalWidth;
    if (m.physicalY + m.physicalHeight > maxPY) maxPY = m.physicalY + m.physicalHeight;
    if (m.logicalX < minLX) minLX = m.logicalX;
    if (m.logicalY < minLY) minLY = m.logicalY;
    if (m.logicalX + m.logicalWidth > maxLX) maxLX = m.logicalX + m.logicalWidth;
    if (m.logicalY + m.logicalHeight > maxLY) maxLY = m.logicalY + m.logicalHeight;
  }
  return {
    physicalX: minPX, physicalY: minPY,
    physicalWidth: maxPX - minPX, physicalHeight: maxPY - minPY,
    logicalX: minLX, logicalY: minLY,
    logicalWidth: maxLX - minLX, logicalHeight: maxLY - minLY,
    scaleFactor: sf,
  };
}

/** Crop a region from a base64 JPEG/PNG image and return as PNG Uint8Array */
export async function cropImage(
  base64: string,
  selection: SelectionDto,
  imageWidth: number,
  imageHeight: number,
): Promise<Uint8Array> {
  const isJpeg = base64.startsWith("/9j/");
  const mime = isJpeg ? "image/jpeg" : "image/png";
  const img = await loadImageFromBase64(base64, mime);

  const canvas = document.createElement("canvas");
  canvas.width = selection.width;
  canvas.height = selection.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(
    img,
    selection.x, selection.y, selection.width, selection.height,
    0, 0, selection.width, selection.height,
  );

  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b!), "image/png"),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

function loadImageFromBase64(base64: string, mime: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `data:${mime};base64,${base64}`;
  });
}
