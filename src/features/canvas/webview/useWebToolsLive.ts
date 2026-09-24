import { createSignal, createEffect } from "solid-js";
import { isTauri } from "@tauri-apps/api/core";
import { webPreviewPing } from "~/services/tauri/canvas";
import { subscribeWebPreviewEvents, type WebPreviewEvent } from "./webToolsBus";

export interface LiveConsoleLine {
  id: string;
  level: "log" | "info" | "warn" | "error" | "debug";
  time: string;
  message: string;
  stack?: string;
  url?: string;
}

export interface LiveNetworkRow {
  id: string;
  kind: string;
  method: string;
  url: string;
  status: number | null;
  durationMs: number | null;
  ok: boolean;
  protocol?: string | null;
  reqSize?: number | null;
  resSize?: number | null;
  snippet?: string;
  headers?: Record<string, string>;
  note?: string;
}

function nowTime(): string {
  return new Date().toLocaleTimeString();
}

function uid(): string {
  return `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

/**
 * Pragmatic live model for a webTools node bound to `targetId` (+ url getter).
 * Probe-only sources: real Rust ping (status/latency), bus events from the
 * preview sibling (navigate/ping/flush), and dev-server session list surfaced
 * as console lines by the caller. The iframe preview has no telemetry hook,
 * so there is no live console/network stream — use a real browser for that.
 */
export function useWebToolsLive(targetId: () => string, url: () => string) {
  const [consoleLines, setConsoleLines] = createSignal<LiveConsoleLine[]>([
    {
      id: uid(),
      level: "info",
      time: nowTime(),
      message: "WebTools ready — pick a linked Web Preview for ping + navigation probes.",
    },
  ]);
  const [networkRows, setNetworkRows] = createSignal<LiveNetworkRow[]>([]);
  const [lastStatus, setLastStatus] = createSignal<number | null>(null);
  const [lastLatency, setLastLatency] = createSignal<number | null>(null);
  const [flushCount, setFlushCount] = createSignal(0);
  const [cookies] = createSignal<Record<string, string>>({});

  const pushConsole = (
    level: LiveConsoleLine["level"],
    message: string,
    extra?: Pick<LiveConsoleLine, "stack" | "url">,
  ) =>
    setConsoleLines((prev) =>
      [...prev, { id: uid(), level, time: nowTime(), message, ...extra }].slice(-300),
    );

  const pushNetwork = (row: Omit<LiveNetworkRow, "id"> & { id?: string }) =>
    setNetworkRows((prev) => [...prev, { ...row, id: row.id ?? uid() }].slice(-300));

  const onEvent = (e: WebPreviewEvent) => {
    if (e.kind === "navigate" && e.url) {
      pushConsole("info", `Navigated → ${e.url}`);
    } else if (e.kind === "ping") {
      setLastStatus(e.status ?? null);
      setLastLatency(e.durationMs ?? null);
      pushNetwork({
        kind: "probe",
        method: e.method ?? "GET",
        url: e.url ?? url(),
        status: e.status ?? null,
        durationMs: e.durationMs ?? null,
        ok: e.ok ?? false,
      });
    } else if (e.kind === "flush") {
      setFlushCount((c) => c + 1);
      pushConsole("warn", `Cache-bypass reload requested for ${e.targetId}.`);
    } else if (e.kind === "console" && e.message) {
      pushConsole(e.level ?? "log", e.message);
    }
  };

  // Re-subscribe whenever the linked target changes (target picker).
  createEffect(() => {
    const t = targetId();
    if (!t) return;
    pushConsole("info", `WebTools attached — probing ${t}.`);
    const unsubEvents = subscribeWebPreviewEvents(t, onEvent);
    return () => {
      unsubEvents();
    };
  });

  const ping = async () => {
    const target = url().trim();
    if (!target) {
      pushConsole("error", "Ping skipped — empty URL.");
      return;
    }
    const started = Date.now();
    try {
      if (isTauri()) {
        const res = await webPreviewPing(target);
        if (res.isOk()) {
          const v = res.value;
          setLastStatus(v.status);
          setLastLatency(v.durationMs);
          pushNetwork({
            kind: "probe",
            method: "GET",
            url: v.url,
            status: v.status,
            durationMs: v.durationMs,
            ok: v.ok,
          });
          pushConsole(
            v.ok ? "info" : "warn",
            `${v.ok ? "OK" : "HTTP"} ${v.status} ${v.url} (${v.durationMs}ms via Rust)`,
          );
          return;
        }
        throw new Error(res.error.message);
      }
      const resp = await fetch(target, { method: "GET", redirect: "follow" });
      const ms = Date.now() - started;
      setLastStatus(resp.status);
      setLastLatency(ms);
      pushNetwork({
        kind: "probe",
        method: "GET",
        url: target,
        status: resp.status,
        durationMs: ms,
        ok: resp.ok,
      });
      pushConsole("info", `${resp.ok ? "OK" : "HTTP"} ${resp.status} ${target} (${ms}ms)`);
    } catch (err) {
      const ms = Date.now() - started;
      setLastStatus(null);
      setLastLatency(ms);
      pushNetwork({
        kind: "probe",
        method: "GET",
        url: target,
        status: null,
        durationMs: ms,
        ok: false,
      });
      pushConsole("error", `Ping failed for ${target}: ${String(err)}`);
    }
  };

  return {
    consoleLines,
    networkRows,
    lastStatus,
    lastLatency,
    flushCount,
    cookies,
    pushConsole,
    clearConsole: () => setConsoleLines([]),
    clearNetwork: () => setNetworkRows([]),
    ping,
  };
}
