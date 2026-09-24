import type { Component, JSX } from "solid-js";
import { Show } from "solid-js";

/** Shared primitives so node bodies don't re-invent section labels/empty states. */
export const NodeSectionLabel: Component<{ children: JSX.Element }> = (props) => (
  <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
    {props.children}
  </span>
);

export const NodeEmpty: Component<{ children: JSX.Element }> = (props) => (
  <div class="rounded bg-muted/40 px-2 py-3 text-center text-[11px] text-muted-foreground">
    {props.children}
  </div>
);

export const NodeError: Component<{ children: JSX.Element }> = (props) => (
  <p class="rounded bg-destructive/10 p-2 text-[11px] text-destructive">{props.children}</p>
);

export const NodeLoading: Component = () => (
  <div class="flex items-center justify-center py-4">
    <span class="iconify mdi--loading animate-spin size-5 text-muted-foreground/40" />
  </div>
);

export const NodeRow: Component<{ children: JSX.Element }> = (props) => (
  <div class="flex flex-col gap-1.5">{props.children}</div>
);

export const NodeActionButton: Component<{
  children: JSX.Element;
  onClick?: () => void;
  variant?: "default" | "primary";
  title?: string;
  disabled?: boolean;
}> = (props) => (
  <button
    type="button"
    onClick={props.onClick}
    disabled={props.disabled}
    title={props.title}
    class="flex flex-1 items-center justify-center gap-1 rounded border border-border/60 bg-secondary/50 py-1 text-[11px] font-medium transition-all hover:bg-secondary active:scale-95 disabled:opacity-40"
    classList={{ "bg-primary/20 text-primary hover:bg-primary/30": props.variant === "primary" }}
  >
    {props.children}
  </button>
);

export const NodeTabBar: Component<{
  tabs: { id: string; label: string; icon?: string; count?: number }[];
  active: string;
  onChange: (id: string) => void;
}> = (props) => (
  <div class="flex items-center rounded-lg border border-border/60 bg-muted/40 p-0.5 text-[11px]">
    {props.tabs.map((t) => (
      <button
        type="button"
        onClick={() => props.onChange(t.id)}
        class="flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 font-medium transition-colors"
        classList={{
          "bg-background text-foreground shadow-sm": props.active === t.id,
          "text-muted-foreground hover:text-foreground": props.active !== t.id,
        }}
      >
        <Show when={t.icon}>
          <span class={`iconify size-3.5 ${t.icon}`} />
        </Show>
        {t.label}
        <Show when={t.count !== undefined && t.count > 0}>
          <span class="rounded-full bg-primary/20 px-1.5 text-[10px] font-semibold text-primary">
            {t.count}
          </span>
        </Show>
      </button>
    ))}
  </div>
);
