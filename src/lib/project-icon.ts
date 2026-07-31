import { convertFileSrc } from "@tauri-apps/api/core";

export function projectIconSrc(projectPath: string, iconPath: string): string {
  const normalizedProject = projectPath.replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedIcon = iconPath.replace(/\\/g, "/").replace(/^\//, "");
  const absolute = `${normalizedProject}/${normalizedIcon}`;
  return convertFileSrc(absolute);
}
