import { createQuery } from "@tanstack/solid-query";
import { For, createMemo } from "solid-js";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { useI18n } from "~/lib/i18n-context";
import { queryKeys } from "~/services/query-keys";
import { getProjectLanguages } from "~/services/tauri/projects";

// Canonical Linguist colors, keyed by language NAME (not extension).
// Source: https://github.com/github-linguist/linguist/blob/main/lib/linguist/languages.yml
// (subset generated via scripts/update-linguist-table.mjs; SQL has no upstream
// color so we keep the previous pv-fallback #e38c00).
const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Rust: "#dea584",
  Go: "#00ADD8",
  Python: "#3572A5",
  "C#": "#7355dd",
  "C++": "#f34b7d",
  C: "#555555",
  Java: "#b07219",
  PHP: "#4F5D95",
  Ruby: "#701516",
  Elixir: "#6e4a7e",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
  Scala: "#c22d40",
  SQL: "#e38c00",
  HTML: "#e34c26",
  CSS: "#663399",
  SCSS: "#c6538c",
  Less: "#1d365d",
  Vue: "#41b883",
  Svelte: "#ff3e00",
  Astro: "#ff5a03",
  TeX: "#3D6117",
  Shell: "#89e051",
  PowerShell: "#012456",
  Batchfile: "#C1F12E",
  Dockerfile: "#384d54",
  CMake: "#DA3434",
  Makefile: "#427819",
  Lua: "#000080",
  Luau: "#000080",
  Dart: "#00B4AB",
  Haskell: "#5e5086",
  OCaml: "#ef7a08",
  Clojure: "#db5855",
  "F#": "#b845fc",
  Perl: "#0298c3",
  R: "#198CE7",
  Julia: "#a270ba",
  Zig: "#ec915c",
  Solidity: "#AA6746",
  GDScript: "#355570",
  CoffeeScript: "#244776",
  Crystal: "#000100",
  Nim: "#ffc200",
  Erlang: "#B83998",
  Elm: "#60B5CC",
  Stylus: "#ff6347",
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
    // Full disk walk per call — never re-run just because the window refocused.
    refetchOnWindowFocus: false,
  }));

  const segments = createMemo(() => {
    const data = q.data;
    if (!data || Object.keys(data).length === 0) return [];

    const otherLabel = t("projectDetail.languageOther") as string;
    // Backend already returns canonical names + byte weighting (GitHub-style),
    // so no ext-grouping is needed here — just percentages + small-slice collapse.
    const total = Object.values(data).reduce((a, b) => a + b, 0);
    if (total === 0) return [];
    const list = Object.entries(data).map(([name, bytes]) => ({
      ext: name,
      name,
      percent: (bytes / total) * 100,
      color: LANGUAGE_COLORS[name] ?? "#888888",
    }));
    list.sort((a, b) => b.percent - a.percent);
    const threshold = 1.5;
    const major = list.filter((s) => s.percent >= threshold);
    const minor = list.filter((s) => s.percent < threshold);
    if (minor.length > 0) {
      const minorPercent = minor.reduce((sum, s) => sum + s.percent, 0);
      major.push({
        ext: "other",
        name: otherLabel,
        percent: minorPercent,
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
                <div class="size-2 rounded-full" style={{ "background-color": s.color }} />
                <span class="font-bold text-foreground">{s.name}</span>
                <span class="text-muted-foreground">{s.percent.toFixed(1)}%</span>
              </div>
            </TooltipContent>
          </Tooltip>
        )}
      </For>
    </div>
  );
}
