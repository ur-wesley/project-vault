import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * Open an external URL in the system browser (Tauri `openUrl`)
 * or a new tab (web fallback). Single home for the pattern
 * previously copy-pasted across node/header/panel components.
 */
export async function openExternal(href: string): Promise<void> {
  if (isTauri()) {
    await openUrl(href);
    return;
  }
  window.open(href, "_blank", "noopener,noreferrer");
}
