import type { ProjectDto } from "~/types/dto";
import { defineDetector } from "./registry";

function taskLabels(p: ProjectDto): string[] {
  return (p.tasks ?? []).map((t) => t.label.toLowerCase());
}

function stackOf(p: ProjectDto): string {
  return p.stack?.toLowerCase() ?? "";
}

/** Modular detectors — one per scope, scored so ties resolve deterministically. */
export function registerBuiltInDetectors(): void {
  defineDetector({
    id: "desktop",
    score: (p) => {
      const stack = stackOf(p);
      const labels = taskLabels(p);
      const path = p.path?.toLowerCase() ?? "";
      if (
        stack.includes("tauri") ||
        path.includes("src-tauri") ||
        labels.some((l) => l.includes("tauri") || l.includes("electron"))
      )
        return 100;
      return 0;
    },
  });
  defineDetector({
    id: "cli",
    score: (p) => {
      const labels = taskLabels(p);
      const name = p.name?.toLowerCase() ?? "";
      if (
        labels.some((l) => l.includes("cli") || l.includes("bin")) ||
        p.tags?.includes("cli") ||
        name.endsWith("-cli") ||
        name.startsWith("cli-")
      )
        return 90;
      return 0;
    },
  });
  defineDetector({
    id: "fullstack",
    score: (p) => {
      const stack = stackOf(p);
      const labels = taskLabels(p);
      if (
        labels.some(
          (l) =>
            l.includes("next") ||
            l.includes("nuxt") ||
            l.includes("remix") ||
            l.includes("compose"),
        ) ||
        stack.includes("next") ||
        stack.includes("rails") ||
        stack.includes("laravel")
      )
        return 80;
      return 10;
    },
  });
  defineDetector({
    id: "server",
    score: (p) => {
      const stack = stackOf(p);
      const labels = taskLabels(p);
      if (
        stack.includes("go") ||
        stack.includes("dotnet") ||
        stack.includes("python") ||
        labels.some((l) => l.includes("server") || l.includes("api") || l.includes("start:prod"))
      )
        return 70;
      return 0;
    },
  });
  defineDetector({
    id: "spa",
    score: (p) => {
      const stack = stackOf(p);
      const labels = taskLabels(p);
      if (
        stack.includes("bun") ||
        stack.includes("node") ||
        labels.some((l) => l.includes("vite") || l.includes("dev") || l.includes("build"))
      )
        return 60;
      return 0;
    },
  });
}

registerBuiltInDetectors();
