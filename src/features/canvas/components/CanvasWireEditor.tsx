import { For, Show, createEffect, createSignal, on, type Component } from "solid-js";
import type { CanvasWireDto } from "~/types/dto";
import { WIRE_STATUS_OPTIONS, WIRE_TYPE_OPTIONS, type WirePatch } from "../state/manualWires";
import { schemasCompatible, type NodePorts } from "../state/portSchemas";
import { isDataWire } from "../state/dataflow";
import { cn } from "~/lib/utils";

export interface WireConversion {
  kind: "assoc" | "data";
  sourcePort?: string | null;
  targetPort?: string | null;
}

export interface CanvasWireEditorProps {
  wire: CanvasWireDto;
  /** Container-relative anchor (px) where the wire was clicked. */
  position: { x: number; y: number };
  /** Live port declarations of both endpoint nodes (null = no data ports). */
  sourcePorts?: NodePorts | null;
  targetPorts?: NodePorts | null;
  /** Input port ids on the target already fed by other data wires. */
  takenTargetPorts?: string[];
  onUpdate?: (patch: Partial<WirePatch>) => void;
  /** Returns false when the conversion was rejected (stays open). */
  onConvert?: (next: WireConversion) => boolean;
  onDelete?: () => void;
  onClose?: () => void;
}

const STATUS_META: Record<string, { label: string; dot: string; active: string }> = {
  nominal: {
    label: "Default",
    dot: "bg-sky-400",
    active: "bg-sky-500/20 text-sky-300 border-sky-500/50",
  },
  amber: {
    label: "Warning",
    dot: "bg-amber-400",
    active: "bg-amber-500/20 text-amber-300 border-amber-500/50",
  },
  red: {
    label: "Alert",
    dot: "bg-red-400",
    active: "bg-red-500/20 text-red-300 border-red-500/50",
  },
};

/**
 * Floating editor for a selected connection: label, color (status) and
 * line type. Positioned at the click anchor by the parent.
 */
export const CanvasWireEditor: Component<CanvasWireEditorProps> = (props) => {
  const [draft, setDraft] = createSignal(props.wire.annotation ?? "");

  // Reset the draft when a different wire gets selected.
  createEffect(
    on(
      () => props.wire.id,
      () => setDraft(props.wire.annotation ?? ""),
    ),
  );

  const commitDraft = () => {
    if (draft() !== (props.wire.annotation ?? "")) {
      props.onUpdate?.({ annotation: draft() });
    }
  };

  // --- Visual <-> dataflow conversion ---
  const canFlow = () =>
    (props.sourcePorts?.outputs.length ?? 0) > 0 && (props.targetPorts?.inputs.length ?? 0) > 0;
  const [outSel, setOutSel] = createSignal(props.wire.sourcePort ?? "");
  const [inSel, setInSel] = createSignal(props.wire.targetPort ?? "");
  const [convertNote, setConvertNote] = createSignal<string | null>(null);

  createEffect(
    on(
      () => props.wire.id,
      () => {
        setOutSel(props.wire.sourcePort ?? "");
        setInSel(props.wire.targetPort ?? "");
        setConvertNote(null);
      },
    ),
  );

  const outDecl = () => props.sourcePorts?.outputs.find((p) => p.id === outSel()) ?? null;
  const inDecl = () => props.targetPorts?.inputs.find((p) => p.id === inSel()) ?? null;
  const bindingOk = () => {
    const o = outDecl();
    const i = inDecl();
    if (!o || !i) return false;
    if (!schemasCompatible(o, i)) return false;
    if ((props.takenTargetPorts ?? []).includes(i.id) && props.wire.targetPort !== i.id)
      return false;
    return true;
  };

  const getBindingError = () => {
    if (!outDecl() || !inDecl()) return "Pick an output and an input port.";
    if ((props.takenTargetPorts ?? []).includes(inSel()) && props.wire.targetPort !== inSel())
      return "That input already has a connection.";
    return "Those ports carry incompatible data.";
  };

  const applyConversion = (kind: "assoc" | "data") => {
    if (kind === "assoc") {
      const ok = props.onConvert?.({ kind }) ?? true;
      if (!ok) setConvertNote("Couldn't convert this connection.");
      return;
    }
    if (!bindingOk()) {
      setConvertNote(getBindingError());
      return;
    }
    setConvertNote(null);
    const ok = props.onConvert?.({ kind, sourcePort: outSel(), targetPort: inSel() }) ?? true;
    if (!ok) setConvertNote("Couldn't convert this connection.");
  };

  return (
    <div
      data-canvas-wire-editor="true"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      class="absolute z-50 w-64 -translate-x-1/2 rounded-xl border border-border/80 bg-popover p-3 shadow-xl backdrop-blur-md animate-in fade-in zoom-in-95"
      style={{ left: `${props.position.x}px`, top: `${props.position.y}px` }}
    >
      <div class="mb-2 flex items-center justify-between">
        <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Connection
        </span>
        <button
          type="button"
          onClick={() => props.onClose?.()}
          title="Close"
          class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <span class="iconify mdi--close size-3.5" />
        </button>
      </div>

      {/* Kind: visual link vs functional dataflow */}
      <span class="mb-1 block text-[11px] font-medium text-muted-foreground">Kind</span>
      <div class="mb-2 grid grid-cols-2 gap-1">
        <button
          type="button"
          onClick={() => applyConversion("assoc")}
          title="Visual link: grouping only, no data flows"
          class={cn(
            "rounded-md border border-transparent px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted",
            !isDataWire(props.wire) && "bg-muted text-foreground border-border/60",
          )}
        >
          Visual link
        </button>
        <button
          type="button"
          onClick={() => applyConversion("data")}
          disabled={!canFlow()}
          title={
            canFlow()
              ? "Dataflow edge: carries data between ports"
              : "Both nodes need data ports for dataflow"
          }
          class={cn(
            "rounded-md border border-transparent px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40",
            isDataWire(props.wire) && "bg-violet-500/20 text-violet-300 border-violet-500/50",
          )}
        >
          Dataflow
        </button>
      </div>

      <Show when={canFlow()}>
        <div class="mb-2 grid grid-cols-2 gap-1.5">
          <label class="block">
            <span class="mb-1 block text-[11px] font-medium text-muted-foreground">Output</span>
            <select
              value={outSel()}
              onChange={(e) => {
                setOutSel(e.currentTarget.value);
                setConvertNote(null);
              }}
              class="w-full rounded-md border border-border/60 bg-background px-1.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            >
              <option value="">—</option>
              <For each={props.sourcePorts?.outputs ?? []}>
                {(p) => (
                  <option value={p.id}>
                    {p.label} ({p.schema})
                  </option>
                )}
              </For>
            </select>
          </label>
          <label class="block">
            <span class="mb-1 block text-[11px] font-medium text-muted-foreground">Input</span>
            <select
              value={inSel()}
              onChange={(e) => {
                setInSel(e.currentTarget.value);
                setConvertNote(null);
              }}
              class="w-full rounded-md border border-border/60 bg-background px-1.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            >
              <option value="">—</option>
              <For each={props.targetPorts?.inputs ?? []}>
                {(p) => (
                  <option
                    value={p.id}
                    disabled={
                      (props.takenTargetPorts ?? []).includes(p.id) &&
                      props.wire.targetPort !== p.id
                    }
                  >
                    {p.label} ({p.schema})
                  </option>
                )}
              </For>
            </select>
          </label>
        </div>
      </Show>
      <Show when={convertNote()}>
        <p class="mb-2 text-[11px] text-amber-400">{convertNote()}</p>
      </Show>

      {/* Label */}
      <label class="mb-2 block">
        <span class="mb-1 block text-[11px] font-medium text-muted-foreground">Label</span>
        <input
          value={draft()}
          maxLength={80}
          placeholder="e.g. triggers deploy"
          onInput={(e) => setDraft(e.currentTarget.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          class="w-full rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
      </label>

      {/* Color / status */}
      <span class="mb-1 block text-[11px] font-medium text-muted-foreground">Color</span>
      <div class="mb-2 grid grid-cols-3 gap-1">
        <For each={WIRE_STATUS_OPTIONS}>
          {(status) => {
            const meta = STATUS_META[status] ?? STATUS_META.nominal;
            const active = () => (props.wire.status ?? "nominal") === status;
            return (
              <button
                type="button"
                onClick={() => props.onUpdate?.({ status })}
                title={meta.label}
                class={cn(
                  "flex items-center justify-center gap-1 rounded-md border border-transparent px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted",
                  active() && meta.active,
                )}
              >
                <span class={cn("size-2 rounded-full", meta.dot)} />
                {meta.label}
              </button>
            );
          }}
        </For>
      </div>

      {/* Line type */}
      <label class="mb-3 block">
        <span class="mb-1 block text-[11px] font-medium text-muted-foreground">Type</span>
        <select
          value={props.wire.wireType ?? "sync"}
          onChange={(e) =>
            props.onUpdate?.({ wireType: e.currentTarget.value as WirePatch["wireType"] })
          }
          class="w-full rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs text-foreground capitalize focus:outline-none focus:ring-1 focus:ring-primary/50"
        >
          <For each={WIRE_TYPE_OPTIONS}>{(t) => <option value={t}>{t}</option>}</For>
        </select>
      </label>

      {/* Delete */}
      <button
        type="button"
        onClick={() => props.onDelete?.()}
        class="flex w-full items-center justify-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20"
      >
        <span class="iconify mdi--delete-outline size-3.5" />
        Delete connection
      </button>
    </div>
  );
};
