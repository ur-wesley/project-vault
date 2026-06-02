import {
  isPermissionGranted as tauriIsPermissionGranted,
  requestPermission as tauriRequestPermission,
  sendNotification as tauriSendNotification,
} from "@tauri-apps/plugin-notification";

let cachedGranted: boolean | null = null;

export async function isNotificationPermissionGranted(): Promise<boolean> {
  if (cachedGranted != null) return cachedGranted;
  try {
    const result = await tauriIsPermissionGranted();
    cachedGranted = Boolean(result);
  } catch {
    cachedGranted = false;
  }
  return cachedGranted;
}

export async function ensureNotificationPermission(): Promise<boolean> {
  const granted = await isNotificationPermissionGranted();
  if (granted) return true;
  try {
    const result = await tauriRequestPermission();
    cachedGranted = result === "granted";
    return cachedGranted;
  } catch {
    cachedGranted = false;
    return false;
  }
}

export async function sendOsNotification(title: string, body?: string): Promise<void> {
  const ok = await ensureNotificationPermission();
  if (!ok) return;
  try {
    tauriSendNotification({ title, body });
  } catch {
    // best-effort; never throw to caller
  }
}
