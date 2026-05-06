import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";
import { openPath } from "@tauri-apps/plugin-opener";
import { treemap } from "~/lib/treemap";
import { formatBytes } from "~/lib/format-bytes";
import { useI18n } from "~/lib/i18n-context";
import { LargestEntriesHoverCard } from "./LargestEntriesList";

type ProjectSizeEntry = {
  projectId: string;
  path: string;
  name: string;
  sizeBytes: number;
};

type ProjectSizeTreemapProps = {
  projects: ProjectSizeEntry[];
};

function hue_for_value(value: number, maxValue: number): number {
  if (maxValue <= 0) return 240;
  const t = Math.sqrt(value / maxValue);
  return Math.round(240 - Math.min(1, t) * 240);
}

export function ProjectSizeTreemap(props: ProjectSizeTreemapProps) {
  const { t } = useI18n();
  let containerRef: HTMLDivElement | undefined;
  const [dims, setDims] = createSignal({ w: 640, h: 320 });

  createEffect(() => {
    const el = containerRef;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setDims({ w: Math.max(1, rect.width), h: Math.max(1, rect.height) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    onCleanup(() => ro.disconnect());
  });

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

  // Group small projects into "Others" — anything below 2% of total
  const grouped = createMemo(() => {
    const items = sorted();
    const total = totalSize();
    if (total === 0) return [];

    const threshold = total * 0.02;
    const big: ProjectSizeEntry[] = [];
    let othersSize = 0;

    for (const item of items) {
      if (item.sizeBytes >= threshold) {
        big.push(item);
      } else {
        othersSize += item.sizeBytes;
      }
    }

    if (othersSize > 0) {
      big.push({
        projectId: "__others__",
        path: "",
        name: t("locations.others") as string,
        sizeBytes: othersSize,
      });
    }

    return big;
  });

  const layout = createMemo(() => {
    const items = grouped().map((p) => ({ value: p.sizeBytes, data: p }));
    if (items.length === 0) return [];
    const { w, h } = dims();
    return treemap(items, 0, 0, w, h);
  });

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
      <div
        ref={containerRef}
        class="relative w-full overflow-hidden rounded-md border border-border/40"
        style={{ height: "320px" }}
      >
        <Show when={layout().length === 0}>
          <div class="flex h-full items-center justify-center text-xs text-muted-foreground">
            {t("locations.noSizeData") as string}
          </div>
        </Show>
        <For each={layout()}>
          {(node) => {
            const hue = hue_for_value(node.data.sizeBytes, maxSize());
            const pct = totalSize() > 0 ? (node.data.sizeBytes / totalSize()) * 100 : 0;
            const showLabel = node.w > 50 && node.h > 30;
            const showSize = node.w > 70 && node.h > 45;
            const isOthers = node.data.projectId === "__others__";
            return (
              <LargestEntriesHoverCard
                path={isOthers ? "" : node.data.path}
                disabled={isOthers}
              >
                <button
                  type="button"
                  class="absolute overflow-hidden text-left transition-all duration-150 hover:brightness-110 hover:z-10 focus:outline-none focus:ring-2 focus:ring-primary/50"
                  style={{
                    left: `${node.x}px`,
                    top: `${node.y}px`,
                    width: `${Math.max(1, node.w)}px`,
                    height: `${Math.max(1, node.h)}px`,
                    "background-color": `hsl(${hue}, 65%, 55%)`,
                  }}
                  onClick={() => !isOthers && handleOpen(node.data.path)}
                  title={isOthers
                    ? `${node.data.name} — ${formatBytes(node.data.sizeBytes)}`
                    : `${node.data.name} — ${formatBytes(node.data.sizeBytes)} (${pct.toFixed(1)}%)`
                  }
                >
                  <Show when={showLabel}>
                    <div class="flex h-full flex-col justify-between p-1.5">
                      <span class="truncate text-[10px] font-bold leading-tight text-white/90 drop-shadow">
                        {node.data.name}
                      </span>
                      <Show when={showSize}>
                        <span class="text-[9px] font-mono leading-tight text-white/70 drop-shadow">
                          {formatBytes(node.data.sizeBytes)}
                        </span>
                      </Show>
                    </div>
                  </Show>
                </button>
              </LargestEntriesHoverCard>
            );
          }}
        </For>
      </div>
    </div>
  );
}
