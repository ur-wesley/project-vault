import { normalizeTreeNode, Treemap } from "nanovis";
import type { TreeNode } from "nanovis";
import { createEffect, createSignal, on, onCleanup, onMount, Show } from "solid-js";
import { formatBytes } from "~/lib/format-bytes";
import { useI18n } from "~/lib/i18n-context";
import type { DirSizeNode } from "~/services/tauri/projects";
import { dirSizeNodeToNanovisInput } from "./lib/dir-size-tree";
import type { DiskUsageMeta } from "./lib/dir-size-tree";

type HoverState = {
  name: string;
  path: string;
  sizeBytes: number;
  x: number;
  y: number;
};

function isDarkMode(): boolean {
  const el = document.documentElement;
  return el.classList.contains("dark") || el.dataset.kbTheme === "dark";
}

/**
 * Size heatmap: hue 240 (blue, small) → 0 (red, large), same convention as
 * the locations size table. Lightness is tuned per theme so the single
 * global canvas text color always has contrast: pastel fills + dark text in
 * light mode, deep fills + light text in dark mode.
 */
function heatmapHue(sizeBytes: number, maxSize: number): number {
  if (maxSize <= 0) return 240;
  const t = Math.sqrt(Math.min(1, sizeBytes / maxSize));
  return Math.round(240 - t * 240);
}

function heatmapFill(sizeBytes: number, maxSize: number, dark: boolean): string {
  const hue = heatmapHue(sizeBytes, maxSize);
  return dark ? `hsl(${hue}, 55%, 42%)` : `hsl(${hue}, 55%, 72%)`;
}

/** Neutral counterpart of the heatmap ramp for excluded (skip) dirs. */
function skipFill(dark: boolean): string {
  return dark ? "hsl(0, 0%, 38%)" : "hsl(0, 0%, 68%)";
}

/**
 * Canvas treemap (nanovis) rendering a recursive `DirSizeNode` tree.
 * Click drills in/out (handled by nanovis), hover shows a tooltip.
 * The instance is rebuilt when `root` changes and disposed on cleanup.
 */
export function ProjectDiskUsageTreemap(props: { root: DirSizeNode }) {
  // eslint-disable-next-line no-unassigned-vars -- Solid ref pattern
  let containerRef!: HTMLDivElement;
  let instance: Treemap<DiskUsageMeta> | null = null;
  const { t } = useI18n();
  const [hover, setHover] = createSignal<HoverState | null>(null);
  const [selectedPath, setSelectedPath] = createSignal<string | null>(null);

  const mount = (root: DirSizeNode) => {
    if (!containerRef) return;
    instance?.dispose();
    instance = null;
    containerRef.innerHTML = "";
    setHover(null);
    setSelectedPath(null);

    const tree = normalizeTreeNode<DiskUsageMeta>(dirSizeNodeToNanovisInput(root));
    // Anchor the scale at the largest top-level entry so colors stay
    // comparable while drilling in and out.
    const maxSize = tree.children[0]?.size ?? tree.size ?? 1;
    const dark = isDarkMode();

    instance = new Treemap<DiskUsageMeta>(tree, {
      getText: (node) => node.text,
      getSubtext: (node) => node.subtext,
      getColor: (node) =>
        node.meta?.isSkip ? skipFill(dark) : heatmapFill(node.size, maxSize, dark),
      palette: dark
        ? {
            text: "#ededed",
            stroke: "#ffffff2e",
            bg: "#101216",
            hover: "#ffffff2e",
            shadow: "#000000aa",
            fg: "#ffffff",
            fallback: "#3a3f46",
          }
        : {
            text: "#222222",
            stroke: "#00000044",
            bg: "#ffffff",
            hover: "#00000022",
            shadow: "#00000055",
            fg: "#ffffff",
            fallback: "#b9bec6",
          },
      onHover: (node: TreeNode<DiskUsageMeta> | null, e?: MouseEvent) => {
        if (!node || !e || !containerRef) {
          setHover(null);
          return;
        }
        const rect = containerRef.getBoundingClientRect();
        setHover({
          name: node.text ?? "",
          path: node.meta?.path ?? "",
          sizeBytes: node.size,
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
      },
      onSelect: (node: TreeNode<DiskUsageMeta> | null) => {
        setSelectedPath(node?.meta?.path ?? null);
      },
    });

    containerRef.append(instance.el);
    // The constructor sizes from el.clientWidth, which can be 0 while the
    // dialog is still animating open — re-measure once laid out.
    requestAnimationFrame(() => instance?.resize());
  };

  onMount(() => {
    mount(props.root);
    const ro = new ResizeObserver(() => instance?.resize());
    if (containerRef) ro.observe(containerRef);
    onCleanup(() => {
      ro.disconnect();
      instance?.dispose();
      instance = null;
    });
  });

  createEffect(
    on(
      () => props.root,
      (root) => {
        if (containerRef) mount(root);
      },
    ),
  );

  const resetSelection = () => {
    instance?.select(null);
    setSelectedPath(null);
  };

  const swatches = () => {
    const dark = isDarkMode();
    const max = props.root.children[0]?.sizeBytes ?? props.root.sizeBytes ?? 1;
    return {
      large: heatmapFill(max, max, dark),
      medium: heatmapFill(max * 0.25, max, dark),
      small: heatmapFill(0, max, dark),
    };
  };

  return (
    <div>
      <div class="mb-1.5 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
        <span
          class="inline-block h-2 w-2 rounded-sm"
          style={{ "background-color": swatches().large }}
        />
        <span>{t("library.diskUsageLarge") as string}</span>
        <span
          class="inline-block h-2 w-2 rounded-sm"
          style={{ "background-color": swatches().medium }}
        />
        <span>{t("library.diskUsageMedium") as string}</span>
        <span
          class="inline-block h-2 w-2 rounded-sm"
          style={{ "background-color": swatches().small }}
        />
        <span>{t("library.diskUsageSmall") as string}</span>
      </div>
      <Show when={selectedPath()}>
        {(path) => (
          <div class="mb-1.5 flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground">
            <span class="truncate font-mono" title={path()}>
              {path()}
            </span>
            <button
              type="button"
              class="shrink-0 rounded px-1 py-0.5 transition-colors hover:bg-muted hover:text-foreground"
              onClick={resetSelection}
            >
              ✕
            </button>
          </div>
        )}
      </Show>
      <div class="relative w-full overflow-auto rounded-md border border-border/40 bg-muted/10">
        <div ref={containerRef} class="w-full" />
        <Show when={hover()}>
          {(h) => (
            <div
              class="pointer-events-none absolute z-10 max-w-56 truncate rounded border border-border bg-popover px-2 py-1 font-mono text-[10px] text-popover-foreground shadow-md"
              style={{
                left: `${Math.max(h().x + 12, 4)}px`,
                top: `${Math.max(h().y + 12, 4)}px`,
              }}
            >
              <div class="truncate font-medium">{h().name}</div>
              <div class="truncate text-muted-foreground">{h().path}</div>
              <div class="tabular-nums">{formatBytes(h().sizeBytes)}</div>
            </div>
          )}
        </Show>
      </div>
      <p class="mt-1.5 text-[10px] leading-snug text-muted-foreground/80">
        {t("library.diskUsageTreemapHint") as string}
      </p>
    </div>
  );
}
