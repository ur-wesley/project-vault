import { For, Show, createSignal, type Component } from "solid-js";
import type { PipelineIssue } from "../state/dataflow";
import { cn } from "~/lib/utils";

export interface CanvasProblemsPanelProps {
  issues: PipelineIssue[];
  onIssueClick?: (issue: PipelineIssue) => void;
}

const ISSUE_ICON: Record<string, string> = {
  cycle: "mdi--sync-alert",
  "missing-input": "mdi--connection",
  schema: "mdi--alert-circle-outline",
  "unknown-port": "mdi--plug-outline",
  "port-taken": "mdi--call-split",
};

/**
 * Live pipeline validation results. Hidden when the dataflow graph is
 * clean; clicking an issue selects its wire (or focuses its node).
 */
export const CanvasProblemsPanel: Component<CanvasProblemsPanelProps> = (props) => {
  const [open, setOpen] = createSignal(false);

  return (
    <Show when={props.issues.length > 0}>
      <div class="pointer-events-auto absolute bottom-4 left-4 z-30 flex max-w-xs flex-col gap-1.5">
        <Show when={open()}>
          <div class="max-h-56 overflow-y-auto rounded-xl border border-amber-500/40 bg-popover p-1.5 shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2">
            <For each={props.issues}>
              {(issue) => (
                <button
                  type="button"
                  onClick={() => props.onIssueClick?.(issue)}
                  class="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted"
                >
                  <span
                    class={cn(
                      "iconify mt-px size-3.5 shrink-0 text-amber-400",
                      ISSUE_ICON[issue.code] ?? "mdi--alert-outline",
                    )}
                  />
                  <span class="text-foreground/90">{issue.message}</span>
                </button>
              )}
            </For>
          </div>
        </Show>
        <button
          type="button"
          onClick={() => setOpen(!open())}
          class="flex items-center gap-1.5 self-start rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-300 shadow-lg backdrop-blur-md transition-all hover:bg-amber-500/25"
        >
          <span class="iconify mdi--alert-outline size-3.5" />
          {props.issues.length} pipeline {props.issues.length === 1 ? "issue" : "issues"}
          <span
            class={cn(
              "iconify mdi--chevron-up size-3 transition-transform",
              open() && "rotate-180",
            )}
          />
        </button>
      </div>
    </Show>
  );
};
