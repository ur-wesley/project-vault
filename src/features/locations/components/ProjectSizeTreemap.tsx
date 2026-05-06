import { For, Show, createMemo } from "solid-js";
import { openPath } from "@tauri-apps/plugin-opener";
import { formatBytes } from "~/lib/format-bytes";
import { useI18n } from "~/lib/i18n-context";
import { LargestEntriesHoverIcon } from "./LargestEntriesList";

type ProjectSizeEntry = {
  projectId: string;
  path: string;
  name: string;
  sizeBytes: number;
};

type ProjectSizeTableProps = {
  projects: ProjectSizeEntry[];
};

function hue_for_value(value: number, maxValue: number): number {
  if (maxValue <= 0) return 240;
  const t = Math.sqrt(value / maxValue);
  return Math.round(240 - Math.min(1, t) * 240);
}

export function ProjectSizeTreemap(props: ProjectSizeTableProps) {
  const { t } = useI18n();

  const sorted = createMemo(() =>
    [...props.projects]
      .filter((p) => p.sizeBytes > 0)
      .sort((a, b) => b.sizeBytes - a.sizeBytes),
  );

  const totalSize = createMemo(() =>
    sorted().reduce((s, p) => s + p.sizeBytes, 0),
  );

  const maxSize = createMemo(() =>
    sorted().reduce((m, p) => Math.max(m, p.sizeBytes), 0),
  );

  const handleOpen = async (path: string) => {
    if (!path) return;
    try {
      await openPath(path);
    } catch {
      // ignore
    }
  };

  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          {sorted().length} projects · {formatBytes(totalSize())}
        </span>
        <span class="flex items-center gap-1.5">
          <span class="inline-block h-2 w-2 rounded-sm" style={{ "background-color": "hsl(0,70%,55%)" }} />
          <span>{t("locations.large") as string}</span>
          <span class="inline-block h-2 w-2 rounded-sm" style={{ "background-color": "hsl(120,60%,50%)" }} />
          <span>{t("locations.medium") as string}</span>
          <span class="inline-block h-2 w-2 rounded-sm" style={{ "background-color": "hsl(240,50%,55%)" }} />
          <span>{t("locations.small") as string}</span>
        </span>
      </div>

      <div class="max-h-[320px] overflow-auto rounded-md border border-border/40">
        <Show when={sorted().length === 0}>
          <div class="flex h-24 items-center justify-center text-xs text-muted-foreground">
            {t("locations.noSizeData") as string}
          </div>
        </Show>
        <Show when={sorted().length > 0}>
          <table class="w-full text-left text-[11px]">
            <thead class="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
              <tr class="border-b border-border/40">
                <th class="px-3 py-1.5 font-semibold text-muted-foreground">{t("locations.projectColumn") as string}</th>
                <th class="px-3 py-1.5 font-semibold text-muted-foreground w-24">{t("locations.sizeColumn") as string}</th>
                <th class="px-3 py-1.5 font-semibold text-muted-foreground w-16 text-right">{t("locations.percentageColumn") as string}</th>
              </tr>
            </thead>
            <tbody>
              <For each={sorted()}>
                {(project) => {
                  const pct = totalSize() > 0 ? (project.sizeBytes / totalSize()) * 100 : 0;
                  const hue = hue_for_value(project.sizeBytes, maxSize());
                  return (
                    <tr
                      class="border-b border-border/20 cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => handleOpen(project.path)}
                    >
                      <td class="px-3 py-1.5">
                        <div class="flex items-center gap-2">
                          <div
                            class="h-2 w-2 shrink-0 rounded-sm"
                            style={{ "background-color": `hsl(${hue}, 65%, 55%)` }}
                          />
                          <span class="truncate font-medium">{project.name}</span>
                          <LargestEntriesHoverIcon path={project.path} />
                        </div>
                        <div class="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            class="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.min(100, pct)}%`,
                              "background-color": `hsl(${hue}, 65%, 55%)`,
                            }}
                          />
                        </div>
                      </td>
                      <td class="px-3 py-1.5 font-mono tabular-nums text-muted-foreground">
                        {formatBytes(project.sizeBytes)}
                      </td>
                      <td class="px-3 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                        {pct.toFixed(1)}%
                      </td>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
        </Show>
      </div>
    </div>
  );
}
