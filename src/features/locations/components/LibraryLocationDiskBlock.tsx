import { type Component } from "solid-js";
import { formatBytes } from "~/lib/format-bytes";
import type { PathDiskSpaceDto } from "~/types/dto";

export type LibraryLocationDiskBlockProps = Readonly<{
  t: (key: string, args?: Record<string, unknown>) => string;
  isPending: boolean;
  isError: boolean;
  row: PathDiskSpaceDto | undefined;
}>;

export const LibraryLocationDiskBlock: Component<LibraryLocationDiskBlockProps> = (props) => {
  if (props.isPending) {
    return <p class="text-xs text-muted-foreground">{props.t("library.loading")}</p>;
  }
  if (props.isError) {
    return <p class="text-xs text-destructive/90">{props.t("library.error")}</p>;
  }
  const row = props.row;
  if (row == null) {
    return <p class="text-xs text-muted-foreground">—</p>;
  }
  if (row.totalBytes === 0) {
    return <p class="text-xs text-muted-foreground">{props.t("locations.diskSpaceUnknown")}</p>;
  }
  const used = row.totalBytes - row.availableBytes;
  const usedPct = Math.max(0, Math.min(100, Math.round((100 * used) / row.totalBytes)));
  const barLabel = props.t("locations.diskVisBarDesc", {
    usedPercent: `${usedPct}%`,
    free: formatBytes(row.availableBytes),
    total: formatBytes(row.totalBytes),
  });
  return (
    <div class="space-y-2">
      <div
        class="h-2.5 w-full overflow-hidden rounded-full bg-muted/90 ring-1 ring-inset ring-border/40"
        role="img"
        aria-label={barLabel}
      >
        <div
          class="h-full min-w-0 rounded-full bg-primary/90 transition-[width]"
          style={{ width: `${usedPct}%` }}
        />
      </div>
      <div class="grid grid-cols-3 gap-2 text-[11px] leading-snug sm:text-xs">
        <div>
          <p class="flex items-center gap-1 font-medium text-muted-foreground">
            <span
              class="iconify mdi--thermometer-low h-3.5 w-3.5 shrink-0 opacity-80"
              aria-hidden="true"
            />
            {props.t("locations.diskVisFree")}
          </p>
          <p class="tabular-nums text-foreground/95">{formatBytes(row.availableBytes)}</p>
        </div>
        <div>
          <p class="flex items-center gap-1 font-medium text-muted-foreground">
            <span
              class="iconify mdi--chart-box-outline h-3.5 w-3.5 shrink-0 opacity-80"
              aria-hidden="true"
            />
            {props.t("locations.diskVisUsed")}
          </p>
          <p class="tabular-nums text-foreground/95">{formatBytes(used)}</p>
        </div>
        <div>
          <p class="flex items-center gap-1 font-medium text-muted-foreground">
            <span
              class="iconify mdi--harddisk h-3.5 w-3.5 shrink-0 opacity-80"
              aria-hidden="true"
            />
            {props.t("locations.diskVisTotal")}
          </p>
          <p class="tabular-nums text-foreground/95">{formatBytes(row.totalBytes)}</p>
        </div>
      </div>
    </div>
  );
};
