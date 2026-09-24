import { For, Show, type Component } from "solid-js";
import { cn } from "~/lib/utils";
import type { WhiteboardStore } from "./useWhiteboardStore";
import { isArrowLabelOnly } from "./useWhiteboardStore";
import { backgroundVariants } from "./colors";
import { boundTextsFor } from "./boundText";
import type { Arrowhead, BackgroundStyle, FontFamily, Roundness, StrokeStyleKind } from "./types";

export const STROKE_COLORS = [
  "#e5e5e5",
  "#ffffff",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#8b5cf6",
  "#a855f7",
  "#ec4899",
  "#1e1e1e",
];

export const FILL_COLORS = [
  "#3b82f6",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#8b5cf6",
  "#ec4899",
  "#e5e5e5",
  "#1e1e1e",
];

export const STROKE_WIDTHS = [1, 2, 4, 8];
export const FONT_SIZES = [12, 16, 20, 28];

const BACKGROUNDS: { id: BackgroundStyle; icon: string; label: string }[] = [
  { id: "transparent", icon: "mdi--square-outline", label: "Transparent fill" },
  { id: "solid", icon: "mdi--square", label: "Solid fill" },
  { id: "hachure", icon: "mdi--square-opacity", label: "Hachure fill" },
  { id: "cross-hatch", icon: "mdi--grid", label: "Cross-hatch fill" },
];

const STROKE_STYLES: { id: StrokeStyleKind; icon: string; label: string }[] = [
  { id: "solid", icon: "mdi--minus", label: "Solid line" },
  { id: "dashed", icon: "mdi--dots-horizontal", label: "Dashed line" },
  { id: "dotted", icon: "mdi--dots-horizontal-circle-outline", label: "Dotted line" },
];

const ROUNDNESS: { id: Roundness; icon: string; label: string }[] = [
  { id: "sharp", icon: "mdi--square-outline", label: "Sharp corners" },
  { id: "round", icon: "mdi--squircle", label: "Round corners" },
];

const FONT_FAMILIES: { id: FontFamily; icon: string; label: string }[] = [
  { id: "hand", icon: "mdi--draw", label: "Hand-drawn font" },
  { id: "normal", icon: "mdi--format-text", label: "Normal font" },
  { id: "code", icon: "mdi--code-tags", label: "Code font" },
];

const ARROWHEADS: { id: Arrowhead; icon: string; label: string }[] = [
  { id: "none", icon: "mdi--minus", label: "No head" },
  { id: "arrow", icon: "mdi--arrow-right", label: "Arrow head" },
  { id: "dot", icon: "mdi--circle", label: "Dot head" },
];

function RowButton(props: {
  title: string;
  label: string;
  pressed: boolean;
  mixed?: boolean;
  onClick: () => void;
  children: unknown;
}) {
  return (
    <button
      type="button"
      title={props.title}
      aria-label={props.label}
      aria-pressed={props.pressed}
      onClick={props.onClick}
      class={cn(
        "rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        props.pressed && "bg-primary/15 text-primary",
        props.mixed && "border border-dashed border-primary/50",
      )}
    >
      {props.children as never}
    </button>
  );
}

function Divider() {
  return <div class="mx-1 h-4 w-px bg-border/60" />;
}

/**
 * Excalidraw-like contextual style panel. Shows the union of relevant
 * controls for the active tool, or for the current selection kinds.
 * Mixed selection values render indeterminate (no pressed state).
 */
export const StylePanel: Component<{ store: WhiteboardStore }> = (props) => {
  const { store } = props;

  const kinds = () => {
    const ids = new Set(store.selectedIds());
    const els = store
      .elements()
      .filter((e) => ids.has(e.id))
      .map((e) => e.kind);
    return new Set(els);
  };
  const hasSel = () => store.selectedIds().length > 0;
  const showShapes = () => {
    if (!hasSel())
      return (
        store.tool() === "rectangle" || store.tool() === "ellipse" || store.tool() === "diamond"
      );
    const k = kinds();
    return k.has("rectangle") || k.has("ellipse") || k.has("diamond");
  };
  const showConnectors = () => {
    if (!hasSel()) return store.tool() === "arrow" || store.tool() === "line";
    const k = kinds();
    return k.has("arrow") || k.has("line");
  };
  const showText = () => {
    if (!hasSel()) return store.tool() === "text";
    return kinds().has("text");
  };
  const showStroke = () => {
    const t = store.tool();
    return hasSel() || (t !== "select" && t !== "eraser" && t !== "text") || showText();
  };

  const sel = () => store.selectionStyle();
  // Arrow labels inherit the connector's styling — only size is settable.
  const arrowLabelOnly = () => hasSel() && isArrowLabelOnly(store.elements(), store.selectedIds());
  // Single selected connector with a bound label: offer the label's size.
  const arrowLabelOf = () => {
    const ids = store.selectedIds();
    if (ids.length !== 1) return null;
    const els = store.elements();
    const el = els.find((e) => e.id === ids[0]);
    if (!el || (el.kind !== "arrow" && el.kind !== "line")) return null;
    const bound = boundTextsFor(els, el.id);
    return bound.length > 0 ? bound[0] : null;
  };

  return (
    <div class="flex flex-wrap items-center gap-1 pb-2" onPointerDown={(e) => e.stopPropagation()}>
      <Show when={showStroke() && !arrowLabelOnly()}>
        <For each={STROKE_COLORS}>
          {(c) => (
            <button
              type="button"
              title={`Stroke ${c}`}
              aria-label={`Stroke ${c}`}
              aria-pressed={(sel().color ?? store.color()) === c}
              onClick={() => store.commitStyle({ color: c })}
              style={{ "background-color": c }}
              class={cn(
                "size-4 rounded-full border border-border/60 transition-transform hover:scale-110",
                (sel().color ?? store.color()) === c &&
                  "ring-2 ring-primary ring-offset-1 ring-offset-card",
                sel().color === undefined && hasSel() && "opacity-70",
              )}
            />
          )}
        </For>
        <input
          type="color"
          title="Custom stroke color"
          aria-label="Custom stroke color"
          value={store.color()}
          onInput={(e) => {
            store.beginStyleGesture();
            store.liveStyle({ color: e.currentTarget.value });
          }}
          onChange={(e) => {
            store.liveStyle({ color: e.currentTarget.value });
            store.endStyleGesture();
          }}
          class="size-4 cursor-pointer rounded-full border border-border/60 bg-transparent p-0"
        />
        <Divider />
        <For each={STROKE_WIDTHS}>
          {(w) => (
            <RowButton
              title={`Stroke ${w}px`}
              label={`Stroke ${w}px`}
              pressed={(sel().strokeWidth ?? store.strokeWidth()) === w}
              onClick={() => store.commitStyle({ strokeWidth: w })}
            >
              <span
                class="mx-auto block rounded-full bg-current"
                style={{ width: `${6 + w * 2}px`, height: `${Math.max(2, w / 2)}px` }}
              />
            </RowButton>
          )}
        </For>
        <Divider />
        <For each={STROKE_STYLES}>
          {(s) => (
            <RowButton
              title={s.label}
              label={s.label}
              pressed={(sel().strokeStyle ?? store.strokeStyle()) === s.id}
              onClick={() => store.commitStyle({ strokeStyle: s.id })}
            >
              <span class={cn("iconify size-4", s.icon)} />
            </RowButton>
          )}
        </For>
      </Show>

      <Show when={showShapes()}>
        <Divider />
        <For each={BACKGROUNDS}>
          {(b) => (
            <RowButton
              title={b.label}
              label={b.label}
              pressed={(sel().background ?? store.background()) === b.id}
              onClick={() => store.commitStyle({ background: b.id })}
            >
              <span class={cn("iconify size-4", b.icon)} />
            </RowButton>
          )}
        </For>
        <Show when={(sel().background ?? store.background()) !== "transparent"}>
          {/* Derived lighter/darker tints of the current stroke color. */}
          <For each={backgroundVariants(sel().color ?? store.color())}>
            {(v) => (
              <button
                type="button"
                title={v.label}
                aria-label={v.label}
                aria-pressed={(sel().fillColor ?? store.fillColor()) === v.value}
                onClick={() => store.commitStyle({ fillColor: v.value })}
                style={{ "background-color": v.value }}
                class={cn(
                  "size-4 rounded border border-border/60 transition-transform hover:scale-110",
                  (sel().fillColor ?? store.fillColor()) === v.value &&
                    "ring-2 ring-primary ring-offset-1 ring-offset-card",
                )}
              />
            )}
          </For>
          <RowButton
            title="Auto fill follows stroke color"
            label="Auto fill"
            pressed={store.isFillAuto()}
            onClick={() => store.resetFillAuto()}
          >
            <span class="iconify mdi--auto-fix size-4" />
          </RowButton>
          <For each={FILL_COLORS}>
            {(c) => (
              <button
                type="button"
                title={`Fill ${c}`}
                aria-label={`Fill ${c}`}
                aria-pressed={(sel().fillColor ?? store.fillColor()) === c}
                onClick={() => store.commitStyle({ fillColor: c })}
                style={{ "background-color": c }}
                class={cn(
                  "size-4 rounded border border-border/60 transition-transform hover:scale-110",
                  (sel().fillColor ?? store.fillColor()) === c &&
                    "ring-2 ring-primary ring-offset-1 ring-offset-card",
                )}
              />
            )}
          </For>
          <input
            type="color"
            title="Custom fill color"
            aria-label="Custom fill color"
            value={sel().fillColor ?? store.fillColor()}
            onInput={(e) => {
              store.beginStyleGesture();
              store.liveStyle({ fillColor: e.currentTarget.value });
            }}
            onChange={(e) => {
              store.liveStyle({ fillColor: e.currentTarget.value });
              store.endStyleGesture();
            }}
            class="size-4 cursor-pointer rounded border border-border/60 bg-transparent p-0"
          />
        </Show>
        <Divider />
        <For each={ROUNDNESS}>
          {(r) => (
            <RowButton
              title={r.label}
              label={r.label}
              pressed={(sel().roundness ?? store.roundness()) === r.id}
              onClick={() => store.commitStyle({ roundness: r.id })}
            >
              <span class={cn("iconify size-4", r.icon)} />
            </RowButton>
          )}
        </For>
      </Show>

      <Show when={showConnectors()}>
        <Divider />
        <span class="px-1 text-[10px] text-muted-foreground">Start</span>
        <For each={ARROWHEADS}>
          {(a) => (
            <RowButton
              title={`Start ${a.label}`}
              label={`Start ${a.label}`}
              pressed={(sel().startArrow ?? store.startArrow()) === a.id}
              onClick={() => store.commitStyle({ startArrow: a.id })}
            >
              <span class={cn("iconify size-4", a.icon)} />
            </RowButton>
          )}
        </For>
        <span class="px-1 text-[10px] text-muted-foreground">End</span>
        <For each={ARROWHEADS}>
          {(a) => (
            <RowButton
              title={`End ${a.label}`}
              label={`End ${a.label}`}
              pressed={(sel().endArrow ?? store.endArrow()) === a.id}
              onClick={() => store.commitStyle({ endArrow: a.id })}
            >
              <span class={cn("iconify size-4", a.icon)} />
            </RowButton>
          )}
        </For>
        <Show when={arrowLabelOf()}>
          {(label) => (
            <>
              <Divider />
              <span class="px-1 text-[10px] text-muted-foreground">Label size</span>
              <For each={FONT_SIZES}>
                {(s) => (
                  <RowButton
                    title={`Label ${s}px`}
                    label={`Label ${s}px`}
                    pressed={label().fontSize === s}
                    onClick={() => store.commitStyle({ fontSize: s })}
                  >
                    <span class="text-[11px] font-semibold leading-none">A{s}</span>
                  </RowButton>
                )}
              </For>
            </>
          )}
        </Show>
      </Show>

      <Show when={showText()}>
        <Divider />
        <For each={FONT_SIZES}>
          {(s) => (
            <RowButton
              title={`Font ${s}px`}
              label={`Font ${s}px`}
              pressed={(sel().fontSize ?? store.fontSize()) === s}
              onClick={() => store.commitStyle({ fontSize: s })}
            >
              <span class="text-[11px] font-semibold leading-none">A{s}</span>
            </RowButton>
          )}
        </For>
        <Show
          when={arrowLabelOnly()}
          fallback={
            <>
              <For each={FONT_FAMILIES}>
                {(f) => (
                  <RowButton
                    title={f.label}
                    label={f.label}
                    pressed={(sel().fontFamily ?? store.fontFamily()) === f.id}
                    onClick={() => store.commitStyle({ fontFamily: f.id })}
                  >
                    <span class={cn("iconify size-4", f.icon)} />
                  </RowButton>
                )}
              </For>
              <For each={["left", "center", "right"] as const}>
                {(a) => (
                  <RowButton
                    title={`Align ${a}`}
                    label={`Align ${a}`}
                    pressed={(sel().textAlign ?? store.textAlign()) === a}
                    onClick={() => store.commitStyle({ textAlign: a })}
                  >
                    <span class={cn("iconify size-4", `mdi--format-align-${a}`)} />
                  </RowButton>
                )}
              </For>
              <RowButton
                title="Bold"
                label="Bold"
                pressed={sel().bold ?? store.bold()}
                onClick={() => store.commitStyle({ bold: !(sel().bold ?? store.bold()) })}
              >
                <span class="iconify mdi--format-bold size-4" />
              </RowButton>
              <RowButton
                title="Italic"
                label="Italic"
                pressed={sel().italic ?? store.italic()}
                onClick={() => store.commitStyle({ italic: !(sel().italic ?? store.italic()) })}
              >
                <span class="iconify mdi--format-italic size-4" />
              </RowButton>
            </>
          }
        >
          <span class="px-1 text-[10px] text-muted-foreground">Size only — inherits arrow style</span>
        </Show>
      </Show>

      <Show when={(showStroke() || showShapes() || showConnectors() || showText()) && !arrowLabelOnly()}>
        <Divider />
        <label
          class="flex items-center gap-1 px-1 text-[10px] text-muted-foreground"
          title="Opacity"
        >
          <span class="iconify mdi--opacity size-4" />
          <input
            type="range"
            min={10}
            max={100}
            step={5}
            value={sel().opacity ?? store.opacity()}
            aria-label="Opacity"
            onPointerDown={() => store.beginStyleGesture()}
            onInput={(e) => {
              store.beginStyleGesture();
              store.liveStyle({ opacity: Number(e.currentTarget.value) });
            }}
            onChange={() => store.endStyleGesture()}
            onPointerUp={() => store.endStyleGesture()}
            class="h-1 w-20 accent-primary"
          />
          <span class="w-8 text-right tabular-nums">{sel().opacity ?? store.opacity()}%</span>
        </label>
      </Show>
    </div>
  );
};
