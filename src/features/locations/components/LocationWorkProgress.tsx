import { Show, type Component } from "solid-js";
import type { MoveProjectProgress } from "~/types/dto";

export type LocationWorkProgressProps = Readonly<{
  label: string;
  progress?: MoveProjectProgress | null;
}>;

export const LocationWorkProgress: Component<LocationWorkProgressProps> = (props) => {
  return (
    <div
      class="mb-1 flex flex-col gap-2.5 rounded-md border border-border/60 bg-muted/35 px-3 py-2.5"
      role="status"
      aria-live="polite"
    >
      <div class="flex items-center gap-2.5 text-sm text-foreground/90">
        <span
          class="iconify mdi--loading h-4 w-4 shrink-0 animate-spin text-primary"
          aria-hidden="true"
        />
        <span class="min-w-0 flex-1 leading-snug">{props.label}</span>
        <Show when={props.progress}>
          <span class="text-[10px] font-mono tabular-nums opacity-60">
            {Math.round((100 * props.progress!.filesDone) / props.progress!.filesTotal)}%
          </span>
        </Show>
      </div>
      <div
        class="h-1.5 w-full overflow-hidden rounded-full bg-muted/80 ring-1 ring-inset ring-border/30"
        aria-hidden="true"
      >
        <Show
          when={props.progress}
          fallback={
            <div class="pv-location-scan-indeterminate h-full w-1/3 max-w-[45%] rounded-full bg-primary/80" />
          }
        >
          <div
            class="h-full bg-primary/80 transition-[width] duration-300"
            style={{
              width: `${Math.round((100 * props.progress!.filesDone) / props.progress!.filesTotal)}%`,
            }}
          />
        </Show>
      </div>
    </div>
  );
};
