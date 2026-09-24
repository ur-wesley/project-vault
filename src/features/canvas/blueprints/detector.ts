import type { AppScope, ProjectDto } from "~/types/dto";

export function detectProjectScope(project: ProjectDto): AppScope {
  const stack = project.stack?.toLowerCase() ?? "";
  const name = project.name?.toLowerCase() ?? "";
  const path = project.path?.toLowerCase() ?? "";
  const taskLabels = (project.tasks ?? []).map((t) => t.label.toLowerCase());

  // 1. Desktop Application
  if (
    stack.includes("tauri") ||
    path.includes("src-tauri") ||
    taskLabels.some((l) => l.includes("tauri") || l.includes("electron"))
  ) {
    return "desktop";
  }

  // 2. CLI tool
  if (
    taskLabels.some((l) => l.includes("cli") || l.includes("bin")) ||
    project.tags?.includes("cli") ||
    name.endsWith("-cli") ||
    name.startsWith("cli-")
  ) {
    return "cli";
  }

  // 3. Full-Stack Web App
  if (
    taskLabels.some(
      (l) =>
        l.includes("next") || l.includes("nuxt") || l.includes("remix") || l.includes("compose"),
    ) ||
    stack.includes("next") ||
    stack.includes("rails") ||
    stack.includes("laravel")
  ) {
    return "fullstack";
  }

  // 4. Server / Backend API
  if (
    stack.includes("go") ||
    stack.includes("dotnet") ||
    stack.includes("python") ||
    taskLabels.some((l) => l.includes("server") || l.includes("api") || l.includes("start:prod"))
  ) {
    return "server";
  }

  // 5. SPA / Frontend Client
  if (
    stack.includes("bun") ||
    stack.includes("node") ||
    taskLabels.some((l) => l.includes("vite") || l.includes("dev") || l.includes("build"))
  ) {
    return "spa";
  }

  // 6. Default / Library
  return "fullstack";
}
