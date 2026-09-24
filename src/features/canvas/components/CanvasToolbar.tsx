import { For, Show, createSignal, type Component } from "solid-js";
import type { AppScope, BlueprintDefinition } from "../blueprints";
import { BUILTIN_BLUEPRINTS } from "../blueprints";
import { cn } from "~/lib/utils";

interface CanvasToolbarProps {
  appScope: AppScope;
  layoutMode: "auto" | "freeform";
  activeBlueprintId?: string;
  snapEnabled: boolean;
  zoom: number;
  onLayoutModeChange: (mode: "auto" | "freeform") => void;
  onBlueprintChange: (blueprint: BlueprintDefinition) => void;
  onAddNode: (type: string, title: string) => void;
  onSnapToggle: () => void;
  onResetView: () => void;
  onFitView: () => void;
  onPopOut?: () => void;
  onSaveAsRecipe?: () => void;
  isFlyout?: boolean;
  followActive?: boolean;
  onToggleFollowActive?: () => void;
}

const SCOPE_META: Record<AppScope, { label: string; icon: string; color: string }> = {
  fullstack: {
    label: "Full-Stack",
    icon: "mdi--web",
    color: "text-sky-400 bg-sky-950/40 border-sky-500/30",
  },
  server: {
    label: "Server / API",
    icon: "mdi--server-network",
    color: "text-indigo-400 bg-indigo-950/40 border-indigo-500/30",
  },
  spa: {
    label: "SPA Client",
    icon: "mdi--application-outline",
    color: "text-cyan-400 bg-cyan-950/40 border-cyan-500/30",
  },
  desktop: {
    label: "Desktop App",
    icon: "mdi--monitor-dashboard",
    color: "text-purple-400 bg-purple-950/40 border-purple-500/30",
  },
  cli: {
    label: "CLI Tool",
    icon: "mdi--console",
    color: "text-emerald-400 bg-emerald-950/40 border-emerald-500/30",
  },
  library: {
    label: "Package / Lib",
    icon: "mdi--package-variant-closed",
    color: "text-amber-400 bg-amber-950/40 border-amber-500/30",
  },
  monorepo: {
    label: "Monorepo",
    icon: "mdi--view-dashboard-outline",
    color: "text-rose-400 bg-rose-950/40 border-rose-500/30",
  },
};

import { toolbarNodeDefs } from "../nodes/registry";
import "../nodes/allNodes";

export const CanvasToolbar: Component<CanvasToolbarProps> = (props) => {
  const [blueprintOpen, setBlueprintOpen] = createSignal(false);
  const [addNodeOpen, setAddNodeOpen] = createSignal(false);

  const scopeInfo = () => SCOPE_META[props.appScope] ?? SCOPE_META.fullstack;
  const activeBlueprint = () => BUILTIN_BLUEPRINTS.find((b) => b.id === props.activeBlueprintId);
  const blueprintLabel = () => activeBlueprint()?.name ?? scopeInfo().label;

  return (
    <div class="flex h-10 w-max max-w-[calc(100vw-1rem)] select-none items-center justify-between gap-3 overflow-visible whitespace-nowrap rounded-full border border-border/40 bg-card/80 py-1 pl-3 pr-2 shadow-lg backdrop-blur-md">
      {/* Left side: Combined Blueprint selector (stack color + active blueprint) & Mode Switcher */}
      <div class="flex min-w-0 shrink items-center gap-2.5">
        {/* Combined stack / Blueprint pill */}
        <div class="relative min-w-0 shrink">
          <button
            type="button"
            onClick={() => setBlueprintOpen(!blueprintOpen())}
            class={`flex min-w-0 max-w-[16rem] items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold transition-all hover:brightness-125 active:scale-95 ${scopeInfo().color}`}
            title={`Blueprint: ${blueprintLabel()} — Scope: ${scopeInfo().label}`}
          >
            <span class={cn("iconify size-3.5 shrink-0", scopeInfo().icon)} />
            <span class="min-w-0 max-w-[8rem] truncate sm:max-w-[12rem]">{blueprintLabel()}</span>
            <span class="iconify mdi--chevron-down size-3 shrink-0 opacity-70" />
          </button>

          <Show when={blueprintOpen()}>
            <div
              class="absolute left-0 mt-1 max-h-[50vh] w-72 max-w-[min(18rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border/80 bg-popover p-1.5 shadow-xl backdrop-blur-md z-50 animate-in fade-in zoom-in-95"
              onPointerLeave={() => setBlueprintOpen(false)}
            >
              <div class="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Built-in Blueprints
              </div>
              <For each={BUILTIN_BLUEPRINTS}>
                {(b) => (
                  <button
                    type="button"
                    onClick={() => {
                      props.onBlueprintChange(b);
                      setBlueprintOpen(false);
                    }}
                    class="flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-muted"
                    classList={{
                      "bg-primary/15 text-primary font-semibold": props.activeBlueprintId === b.id,
                    }}
                  >
                    <span class={cn("iconify mt-0.5 size-4 shrink-0 text-primary", b.icon)} />
                    <div class="min-w-0 flex-1 overflow-hidden">
                      <div class="truncate font-medium">{b.name}</div>
                      <div class="whitespace-normal break-words text-[10px] leading-snug text-muted-foreground">
                        {b.description}
                      </div>
                    </div>
                    <Show when={props.activeBlueprintId === b.id}>
                      <span class="iconify mt-0.5 size-4 shrink-0 text-primary mdi--check" />
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>

        {/* Layout Mode Toggle */}
        <div class="flex items-center rounded-lg border border-border/60 bg-muted/40 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => props.onLayoutModeChange("auto")}
            class="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1 font-medium transition-colors"
            classList={{
              "bg-background text-foreground shadow-sm": props.layoutMode === "auto",
              "text-muted-foreground hover:text-foreground": props.layoutMode !== "auto",
            }}
            title="Auto-Layout (Hierarchical DAG Columns)"
          >
            <span class="iconify mdi--source-branch size-3.5 shrink-0" />
            <span class="hidden lg:inline">Auto</span>
          </button>
          <button
            type="button"
            onClick={() => props.onLayoutModeChange("freeform")}
            class="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1 font-medium transition-colors"
            classList={{
              "bg-background text-foreground shadow-sm": props.layoutMode === "freeform",
              "text-muted-foreground hover:text-foreground": props.layoutMode !== "freeform",
            }}
            title="Freely Draggable Spatial Canvas"
          >
            <span class="iconify mdi--cursor-move size-3.5 shrink-0" />
            <span class="hidden lg:inline">Freeform</span>
          </button>
        </div>
      </div>

      {/* Center: Add Node */}
      <div class="flex shrink-0 items-center gap-1.5">
        {/* Add Node Dropdown */}
        <div class="relative shrink-0">
          <button
            type="button"
            onClick={() => setAddNodeOpen(!addNodeOpen())}
            class="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-primary/40 bg-primary/20 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/30 active:scale-95 transition-all"
          >
            <span class="iconify mdi--plus size-3.5 shrink-0" />
            <span class="hidden sm:inline">Add Node</span>
          </button>

          <Show when={addNodeOpen()}>
            <div
              class="absolute left-0 mt-1 max-h-[50vh] w-52 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-border/80 bg-popover p-1 shadow-xl backdrop-blur-md z-50 animate-in fade-in zoom-in-95"
              onPointerLeave={() => setAddNodeOpen(false)}
            >
              <For each={toolbarNodeDefs()}>
                {(item) => (
                  <button
                    type="button"
                    onClick={() => {
                      props.onAddNode(item.type, item.title);
                      setAddNodeOpen(false);
                    }}
                    class="flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-muted"
                  >
                    <span class={cn("iconify size-4 text-primary shrink-0", item.icon)} />
                    <span class="min-w-0 flex-1 truncate">{item.title}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>

      {/* Right side: Snap, Zoom, Flyout */}
      <div class="flex shrink-0 items-center gap-1.5 text-xs">
        {/* Follow Active Toggle (Flyout mode) */}
        <Show when={props.isFlyout}>
          <button
            type="button"
            onClick={props.onToggleFollowActive}
            class="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 font-medium text-xs transition-all"
            classList={{
              "bg-emerald-500/20 text-emerald-400 border-emerald-500/40": props.followActive,
              "bg-muted/40 text-muted-foreground border-border/60": !props.followActive,
            }}
            title={
              props.followActive ? "Following currently active project" : "Pinned to this project"
            }
          >
            <span
              class="iconify size-3.5"
              classList={{
                "mdi--sync animate-spin": !!props.followActive,
                "mdi--pin": !props.followActive,
              }}
            />
            <span>{props.followActive ? "Follow: ON" : "Pinned"}</span>
          </button>
        </Show>

        {/* Snap Grid Toggle */}
        <button
          type="button"
          onClick={props.onSnapToggle}
          class="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          classList={{ "text-primary": props.snapEnabled }}
          title={props.snapEnabled ? "Grid Snap (16px) Enabled" : "Grid Snap Disabled"}
        >
          <span class="iconify mdi--grid size-4" />
        </button>

        {/* Reset / Fit View */}
        <button
          type="button"
          onClick={props.onResetView}
          class="shrink-0 whitespace-nowrap rounded p-1.5 font-mono text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Reset View to 100%"
        >
          {Math.round(props.zoom * 100)}%
        </button>
        <button
          type="button"
          onClick={props.onFitView}
          class="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Fit All Nodes into View"
        >
          <span class="iconify mdi--fit-to-page-outline size-4" />
        </button>

        {/* Pop-Out Button */}
        <Show when={!props.isFlyout && props.onPopOut}>
          <div class="h-4 w-px shrink-0 bg-border/60 mx-1" />
          <button
            type="button"
            onClick={props.onPopOut}
            class="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-border/60 bg-secondary/50 px-2.5 py-1 text-xs font-medium hover:bg-secondary active:scale-95 transition-all text-foreground"
            title="Pop out Canvas into an external window on second monitor"
          >
            <span class="iconify mdi--open-in-new size-3.5 shrink-0 text-primary" />
            <span class="hidden lg:inline">Pop Out</span>
          </button>
        </Show>
      </div>
    </div>
  );
};
