import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { availableMonitors } from "@tauri-apps/api/window";

export async function openCanvasWindow(
  projectId: string,
  follow: boolean = true,
): Promise<WebviewWindow> {
  const winId = `canvas-${Date.now()}`;

  let x: number | undefined;
  let y: number | undefined;

  try {
    const monitors = await availableMonitors();
    // If a secondary monitor exists, spawn on monitor 2!
    if (monitors.length > 1) {
      const mon2 = monitors[1];
      x = mon2.position.x + 50;
      y = mon2.position.y + 50;
    }
  } catch {
    // Default system placement
  }

  const win = new WebviewWindow(winId, {
    url: `/canvas-window.html?projectId=${encodeURIComponent(projectId)}&follow=${follow ? "true" : "false"}`,
    title: "Project Context Canvas",
    width: 1280,
    height: 820,
    minWidth: 700,
    minHeight: 500,
    x,
    y,
    decorations: true,
    focus: true,
  });

  return win;
}
