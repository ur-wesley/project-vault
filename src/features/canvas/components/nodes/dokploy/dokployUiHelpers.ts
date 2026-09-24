import { isTauri } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";

import { formatRelativeTime } from "~/lib/format-date";

/** Confirm dialog that works in Tauri and web. (Moved verbatim from DokployNode.) */
export async function confirmRedeploy(message: string): Promise<boolean> {
  if (isTauri()) {
    return await ask(message, { title: "Project Vault", kind: "warning" });
  }
  return window.confirm(message);
}

export function deploymentStatusIcon(status: string): string {
  const s = status.toLowerCase();
  if (s === "done") return "mdi--check-circle text-green-500";
  if (s === "error") return "mdi--alert-circle text-destructive";
  if (s === "running" || s === "pending") return "mdi--loading animate-spin text-blue-500";
  return "mdi--circle-outline text-muted-foreground";
}

export function relativeTime(iso: string | null, locale: string): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  try {
    return formatRelativeTime(ms, locale) ?? "";
  } catch {
    return "";
  }
}
