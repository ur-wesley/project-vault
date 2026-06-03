import { invoke, isTauri } from "@tauri-apps/api/core";

export async function sendOsNotification(title: string, body?: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("show_system_notification", {
      title,
      body: body?.trim() ? body : null,
    });
  } catch (e) {
    console.error("[notifications] OS notification failed:", e);
  }
}
