import type {
  ClipboardEntryDto,
  ClipboardHistorySettingsDto,
  ClipboardOverlayPositionDto,
} from "~/types/dto";
import { tauriInvoke } from "./utils";

export function listClipboardHistory(args?: {
  query?: string;
  kind?: string;
  limit?: number;
  offset?: number;
}) {
  return tauriInvoke<ClipboardEntryDto[]>("list_clipboard_history", { args: args ?? {} });
}

export function deleteClipboardEntry(id: string) {
  return tauriInvoke<void>("delete_clipboard_entry", { id });
}

export function clearClipboardHistory(keepPinned?: boolean) {
  return tauriInvoke<void>("clear_clipboard_history", {
    args: { keepPinned: keepPinned ?? false },
  });
}

export function updateClipboardEntry(id: string, text: string) {
  return tauriInvoke<void>("update_clipboard_entry", { args: { id, text } });
}

export function toggleClipboardPin(id: string) {
  return tauriInvoke<void>("toggle_clipboard_pin", { id });
}

export function applyClipboardEntry(id: string) {
  return tauriInvoke<void>("apply_clipboard_entry", { id });
}

export function getClipboardHistorySettings() {
  return tauriInvoke<ClipboardHistorySettingsDto>("get_clipboard_history_settings");
}

export function setClipboardHistorySettings(settings: ClipboardHistorySettingsDto) {
  return tauriInvoke<void>("set_clipboard_history_settings", { settings });
}

export function saveClipboardForegroundWindow() {
  return tauriInvoke<void>("save_clipboard_foreground_window");
}

export function captureClipboardOverlayAnchor() {
  return tauriInvoke<void>("capture_clipboard_overlay_anchor");
}

export function getClipboardOverlayPosition(width: number, height: number) {
  return tauriInvoke<ClipboardOverlayPositionDto>("get_clipboard_overlay_position", {
    width,
    height,
  });
}

export function closeClipboardOverlay() {
  return tauriInvoke<void>("close_clipboard_overlay");
}

export function prepareClipboardOverlayWindow() {
  return tauriInvoke<void>("prepare_clipboard_overlay_window");
}

export function getClipboardEntryThumbnail(id: string, maxSize?: number) {
  return tauriInvoke<string | null>("get_clipboard_entry_thumbnail", {
    id,
    maxSize: maxSize ?? 56,
  });
}
