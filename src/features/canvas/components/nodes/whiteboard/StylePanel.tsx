import { For, Show, type Component } from "solid-js";
import { cn } from "~/lib/utils";
import type { WhiteboardStore } from "./useWhiteboardStore";
import { isArrowLabelOnly, type ArrowheadName, type FontName, type RoundnessName } from "./whiteboardStyle";
import { backgroundVariants, ROUGHNESS_LEVELS, type ExcalidrawFillStyle, type ExcalidrawStrokeStyle } from "./colors";
import { boundTextsFor } from "./boundText";

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

/** Excalidraw stroke widths: thin / base / bold. */
export const STROKE_WIDTHS = [1, 2, 4];
export const FONT_SIZES = [12, 16, 20, 28];

/**
 * Excalidraw-native field names throughout: strokeColor, backgroundColor,
 * fillStyle, roughness 0 Architect / 1 Artist / 2 Cartoonist.
 */
export const ROUGHNESS = ROUGHNESS_LEVELS;

const BACKGROUNDS: { id: ExcalidrawFillStyle; icon: string; label: string }[] = [
  { id: "transparent", icon: "mdi--square-outline", label: "Transparent fill" },
  { id: "solid", icon: "mdi--square", label: "Solid fill" },
  { id: "hachure", icon: "mdi--square-opacity", label: "Hachure fill" },
  { id: "cross-hatch", icon: "mdi--grid", label: "Cross-hatch fill" },
];

const STROKE_STYLES: { id: ExcalidrawStrokeStyle; icon: string; label: string }[] = [
  { id: "solid", icon: "mdi--minus", label: "Solid line" },
  { id: "dashed", icon: "mdi--dots-horizontal", label: "Dashed line" },
  { id: "dotted", icon: "mdi--dots-horizontal-circle-outline", label: "Dotted line" },
];

const ROUNDNESS: { id: RoundnessName; icon: string; label: string }[] = [
  { id: "sharp", icon: "mdi--square-outline", label: "Sharp corners" },
  { id: "round", icon: "mdi--squircle", label: "Round corners" },
];

const FONT_FAMILIES: { id: FontName; icon: string; label: string }[] = [
  { id: "hand", icon: "mdi--draw", label: "Hand-drawn font" },
  { id: "normal", icon: "mdi--format-text", label: "Normal font" },
  { id: "code", icon: "mdi--code-tags", label: "Code font" },
];

const ARROWHEADS: { id: ArrowheadName; icon: string; label: string }[] = [
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

function roughnessGlyph(value: number): string {
  if (value === 0) return "A";
  if (value === 2) return "C";
  return "B";
}

function Divider() {
  return <div class="mx-1 h-4 w-px bg-border/60" />;
}

/**
 * Excalidraw-like contextual style panel. Shows the union of relevant
 * controls for the active tool, or for the current selection types.
 * Mixed selection values render indeterminate (no pressed state).
 */
export const StylePanel: Component<{ store: WhiteboardStore }> = (props) => {
  const { store } = props;

  const types = () => {
    const ids = new Set(store.selectedIds());
    const els = store
      .elements()
      .filter((e) => ids.has(e.id))
      .map((e) => e.type);
    return new Set(els);
  };
  const hasSel = () => store.selectedIds().length > 0;
  const showShapes = () => {
    if (!hasSel())
      return (
        store.tool() === "rectangle" || store.tool() === "ellipse" || store.tool() === "diamond"
      );
    const k = types();
    return k.has("rectangle") || k.has("ellipse") || k.has("diamond");
  };
  const showConnectors = () => {
    if (!hasSel()) return store.tool() === "arrow" || store.tool() === "line";
    const k = types();
    return k.has("arrow") || k.has("line");
  };
  const showText = () => {
    if (!hasSel()) return store.tool() === "text";
    return types().has("text");
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
    if (!el || (el.type !== "arrow" && el.type !== "line")) return null;
    const bound = boundTextsFor(els, el.id);
    return bound.length > 0 ? bound[0] : null;
  };

  return (
    <div class="flex flex-wrap items-center gap-1 pb-2" onPointerDown={(e) => e.stopPropagation()}>
      <Show when={showStroke() && !arrowLabelOnly()}>
        {/* strokeColor palette. */}
        <For each={STROKE_COLORS}>
          {(c) => (
            <button
              type="button"
              title={`strokeColor ${c}`}
              aria-label={`strokeColor ${c}`}
              aria-pressed={(sel().strokeColor ?? store.strokeColor()) === c}
              onClick={() => store.commitStyle({ strokeColor: c })}
              style={{ "background-color": c }}
              class={cn(
                "size-4 rounded-full border border-border/60 transition-transform hover:scale-110",
                (sel().strokeColor ?? store.strokeColor()) === c &&
                  "ring-2 ring-primary ring-offset-1 ring-offset-card",
                sel().strokeColor === undefined && hasSel() && "opacity-70",
              )}
            />
          )}
        </For>
        <input
          type="color"
          title="Custom strokeColor"
          aria-label="Custom strokeColor"
          value={store.strokeColor()}
          onInput={(e) => {
            store.beginStyleGesture();
            store.liveStyle({ strokeColor: e.currentTarget.value });
          }}
          onChange={(e) => {
            store.liveStyle({ strokeColor: e.currentTarget.value });
            store.endStyleGesture();
          }}
          class="size-4 cursor-pointer rounded-full border border-border/60 bg-transparent p-0"
        />
        <Divider />
        {/* strokeWidth 1/2/4 (Excalidraw). */}
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
        <Divider />
        {/* Roughness 0 Architect / 1 Artist / 2 Cartoonist (strokeColor-family). */}
        <For each={ROUGHNESS}>
          {(r) => (
            <RowButton
              title={`${r.label} (roughness ${r.value}) — ${r.hint}`}
              label={`${r.label} roughness`}
              pressed={(sel().roughness ?? store.roughness()) === r.value}
              onClick={() => store.commitStyle({ roughness: r.value })}
            >
              <span class="text-[11px] font-semibold leading-none">
                {roughnessGlyph(r.value)}
              </span>
            </RowButton>
          )}
        </For>
      </Show>

      <Show when={showShapes()}>
        <Divider />
        {/* fillStyle. */}
        <For each={BACKGROUNDS}>
          {(b) => (
            <RowButton
              title={`${b.label} (fillStyle ${b.id})`}
              label={`${b.label} (fillStyle ${b.id})`}
              pressed={(sel().fillStyle ?? store.fillStyle()) === b.id}
              onClick={() => store.commitStyle({ fillStyle: b.id })}
            >
              <span class={cn("iconify size-4", b.icon)} />
            </RowButton>
          )}
        </For>
        <Show when={(sel().fillStyle ?? store.fillStyle()) !== "transparent"}>
          {/* backgroundColor swatches. */}
          <For each={backgroundVariants(sel().strokeColor ?? store.strokeColor())}>
            {(v) => (
              <button
                type="button"
                title={v.label}
                aria-label={v.label}
                aria-pressed={(sel().backgroundColor ?? store.backgroundColor()) === v.value}
                onClick={() => store.commitStyle({ backgroundColor: v.value })}
                style={{ "background-color": v.value }}
                class={cn(
                  "size-4 rounded border border-border/60 transition-transform hover:scale-110",
                  (sel().backgroundColor ?? store.backgroundColor()) === v.value &&
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
                title={`backgroundColor ${c}`}
                aria-label={`backgroundColor ${c}`}
                aria-pressed={(sel().backgroundColor ?? store.backgroundColor()) === c}
                onClick={() => store.commitStyle({ backgroundColor: c })}
                style={{ "background-color": c }}
                class={cn(
                  "size-4 rounded border border-border/60 transition-transform hover:scale-110",
                  (sel().backgroundColor ?? store.backgroundColor()) === c &&
                    "ring-2 ring-primary ring-offset-1 ring-offset-card",
                )}
              />
            )}
          </For>
          <input
            type="color"
            title="Custom backgroundColor"
            aria-label="Custom backgroundColor"
            value={sel().backgroundColor ?? store.backgroundColor()}
            onInput={(e) => {
              store.beginStyleGesture();
              store.liveStyle({ backgroundColor: e.currentTarget.value });
            }}
            onChange={(e) => {
              store.liveStyle({ backgroundColor: e.currentTarget.value });
              store.endStyleGesture();
            }}
            class="size-4 cursor-pointer rounded border border-border/60 bg-transparent p-0"
          />
        </Show>
        <Divider />
        {/* Roundness toggle: sharp (type 0) / round (per-type). */}
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
              pressed={(sel().startArrowhead ?? store.startArrowhead()) === a.id}
              onClick={() => store.commitStyle({ startArrowhead: a.id })}
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
              pressed={(sel().endArrowhead ?? store.endArrowhead()) === a.id}
              onClick={() => store.commitStyle({ endArrowhead: a.id })}
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
            min={0}
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
