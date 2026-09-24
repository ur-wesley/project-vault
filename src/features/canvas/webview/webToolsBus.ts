/** Shared live channel between a webPreview node and its sibling webTools nodes. */

export interface WebPreviewEvent {
  kind: "navigate" | "ping" | "flush" | "console";
  targetId: string;
  atMs: number;
  url?: string;
  method?: string;
  status?: number;
  durationMs?: number;
  ok?: boolean;
  message?: string;
  level?: "log" | "info" | "warn" | "error";
}

import { createEventBus } from "./eventBus";

type Listener = (e: WebPreviewEvent) => void;

const previewBus = createEventBus<WebPreviewEvent>({
  keyOf: (e) => e.targetId,
  wildcardKey: "*",
});

export function emitWebPreviewEvent(e: WebPreviewEvent): void {
  previewBus.emit(e);
}

export function subscribeWebPreviewEvents(targetId: string, fn: Listener): () => void {
  return previewBus.subscribeKeyed(targetId, fn);
}

/** Parse dataJson safely; returns targetId link for webTools nodes. */
export function parseWebToolsTarget(dataJson?: string | null): string | null {
  if (!dataJson) return null;
  try {
    const v = JSON.parse(dataJson) as { targetId?: unknown };
    return typeof v.targetId === "string" && v.targetId.length > 0 ? v.targetId : null;
  } catch {
    return null;
  }
}

export function encodeWebToolsTarget(targetId: string): string {
  return JSON.stringify({ targetId });
}

/**
 * Returns the id of the webTools node linked to a preview, or null.
 * Enforces the 1:1 rule: each webview has at most one sibling webtools.
 */
export function linkedToolsId(
  nodes: readonly { id: string; nodeType: string; dataJson?: string | null }[],
  targetId: string,
): string | null {
  for (const n of nodes) {
    if (n.nodeType !== "webTools") continue;
    if (parseWebToolsTarget(n.dataJson) === targetId) return n.id;
  }
  return null;
}
