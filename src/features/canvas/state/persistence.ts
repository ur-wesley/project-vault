import type { CanvasProjectLayoutDto, ViewportDto } from "~/types/dto";
import { saveCanvasLayout } from "~/services/tauri/canvas";

/** Debounced layout persistence — single place for save timing + payload shape. */
export function createLayoutSaver(opts: {
  delayMs?: number;
  build: () => CanvasProjectLayoutDto | null;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const saveNow = async () => {
    const payload = opts.build();
    if (!payload?.projectId) return;
    await saveCanvasLayout({ ...payload, schemaVersion: 2 });
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void saveNow(), opts.delayMs ?? 800);
  };
  const dispose = () => {
    if (timer) clearTimeout(timer);
  };
  return { schedule, saveNow, dispose };
}

export const DEFAULT_VIEWPORT: ViewportDto = { panX: 0, panY: 0, zoom: 1 };
