import { createQuery } from "@tanstack/solid-query";
import { For, createMemo } from "solid-js";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { useI18n } from "~/lib/i18n-context";
import { queryKeys } from "~/services/query-keys";
import { getProjectLanguages } from "~/services/tauri/projects";

const LANGUAGE_COLORS: Record<string, string> = {
  js: "#f1e05a", jsx: "#f1e05a", ts: "#3178c6", tsx: "#3178c6", rs: "#dea584",
  rust: "#dea584", go: "#00ADD8", py: "#3572A5", python: "#3572A5", cs: "#178600",
  csharp: "#178600", cpp: "#f34b7d", c: "#555555", java: "#b07219", php: "#4F5D95",
  rb: "#701516", ruby: "#701516", ex: "#6e4a7e", elixir: "#6e4a7e", swift: "#F05138",
  kt: "#A97BFF", kotlin: "#A97BFF", sql: "#e38c00", toml: "#9c4221", yaml: "#cb171e",
  yml: "#cb171e", json: "#29b544", html: "#e34c26", css: "#563d7c", md: "#083fa1",
  sh: "#89e051", bash: "#89e051", docker: "#384d54", dockerfile: "#384d54", plaintext: "#cccccc",
};

const LANG_NAME_MAP: Record<string, string> = {
  js: "JavaScript", jsx: "JavaScript", ts: "TypeScript", tsx: "TypeScript",
  rs: "Rust", py: "Python", cs: "C#", cpp: "C++", c: "C", rb: "Ruby",
  ex: "Elixir", kt: "Kotlin", yml: "YAML", md: "Markdown",
};

export function LanguageBar(props: { projectId: string }) {
  const { t } = useI18n();
  const q = createQuery(() => ({
    queryKey: queryKeys.projectLanguages(props.projectId),
    queryFn: async () => {
      const r = await getProjectLanguages(props.projectId);
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    staleTime: 1000 * 60 * 5,
  }));

  const segments = createMemo(() => {
    const data = q.data;
    if (!data || Object.keys(data).length === 0) return [];

    const total = Object.values(data).reduce((a, b) => a + b, 0);
    const grouped = new Map<
      string,
      { count: number; color: string; ext: string }
    >();
    for (const [ext, count] of Object.entries(data)) {
      const name = LANG_NAME_MAP[ext] || ext.toUpperCase();
      const color = LANGUAGE_COLORS[ext] || "#888888";
      const existing = grouped.get(name);
      if (existing) existing.count += count;
      else grouped.set(name, { count, color, ext });
    }
    const list = Array.from(grouped.entries())
      .map(([name, info]) => ({
        ext: info.ext,
        name,
        percent: (info.count / total) * 100,
        color: info.color,
      }))
      .sort((a, b) => b.percent - a.percent);
    const threshold = 1.5;
    const major = list.filter((s) => s.percent >= threshold);
    const minor = list.filter((s) => s.percent < threshold);
    if (minor.length > 0) {
      major.push({
        ext: "other",
        name: t("projectDetail.languageOther") as string,
        percent: minor.reduce((sum, s) => sum + s.percent, 0),
        color: "#666666",
      });
    }
    return major;
  });

  return (
    <div class="flex h-1.5 w-full overflow-hidden bg-muted/20">
      <For each={segments()}>
        {(s) => (
          <Tooltip openDelay={100}>
            <TooltipTrigger
              as="div"
              class="h-full transition-all hover:scale-y-125 cursor-help"
              style={{ width: `${s.percent}%`, "background-color": s.color }}
            />
            <TooltipContent>
              <div class="flex items-center gap-2 font-mono text-[10px]">
                <div
                  class="size-2 rounded-full"
                  style={{ "background-color": s.color }}
                />
                <span class="font-bold text-foreground">{s.name}</span>
                <span class="text-muted-foreground">
                  {s.percent.toFixed(1)}%
                </span>
              </div>
            </TooltipContent>
          </Tooltip>
        )}
      </For>
    </div>
  );
}
