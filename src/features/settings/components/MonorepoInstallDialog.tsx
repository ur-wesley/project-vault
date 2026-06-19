import { createEffect, createMemo, createSignal, For, Show, type Component } from "solid-js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";

export type MonorepoEntry = {
  id: string;
  dir: string | null;
  name: string | null;
  description: string | null;
  version: string | null;
  category: string | null;
  existing: boolean;
};

export type MonorepoDiscovery = {
  repo: string;
  slug: string;
  branch: string | null;
  tag: string | null;
  commit: string | null;
  kind: "monorepo" | "single";
  entries: MonorepoEntry[];
};

export const MonorepoInstallDialog: Component<{
  t: (key: string, params?: Record<string, unknown>) => string;
  discovery: MonorepoDiscovery | null;
  onCancel: () => void;
  onInstall: (selectedIds: string[]) => void | Promise<void>;
  busy?: boolean;
}> = (props) => {
  const [selected, setSelected] = createSignal<Set<string>>(new Set<string>());

  const initial = createMemo(() => {
    const set = new Set<string>();
    const d = props.discovery;
    if (d) {
      for (const e of d.entries) {
        set.add(e.id);
      }
    }
    return set;
  });

  // re-sync when a new discovery arrives
  createEffect(() => {
    // depend on discovery identity and entry count
    void props.discovery?.repo;
    void props.discovery?.entries.length;
    setSelected(new Set<string>(initial()));
  });

  const selectedCount = createMemo(() => {
    let n = 0;
    for (const id of selected()) {
      if (initial().has(id)) n++;
    }
    return n;
  });

  const toggle = (id: string) => {
    const next = new Set<string>(selected());
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelected(next);
  };

  const selectAll = () => {
    setSelected(new Set<string>(initial()));
  };

  const selectNone = () => {
    setSelected(new Set<string>());
  };

  const installLabel = () => {
    const n = selectedCount();
    if (n === 0) return props.t("pluginsDashboard.monorepoPickerInstallZero");
    if (n === 1) return props.t("pluginsDashboard.monorepoPickerInstallBtnOne");
    return props.t("pluginsDashboard.monorepoPickerInstallBtn", { count: n });
  };

  const handleInstall = async () => {
    const ids = Array.from(selected());
    await props.onInstall(ids);
  };

  return (
    <Dialog
      open={!!props.discovery}
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
    >
      <DialogContent class="sm:max-w-[560px]">
        <Show when={props.discovery}>
          {(d) => (
            <>
              <DialogHeader>
                <DialogTitle>{props.t("pluginsDashboard.monorepoPickerTitle")}</DialogTitle>
                <DialogDescription>
                  {props.t("pluginsDashboard.monorepoPickerSubtitle")}
                </DialogDescription>
              </DialogHeader>

              <div class="space-y-3">
                <div class="rounded bg-muted/30 border border-border/50 p-3 font-mono text-[10px] break-all space-y-1">
                  <div class="flex flex-col">
                    <span class="text-muted-foreground font-semibold">Repository:</span>
                    <span class="text-foreground select-text">{d().repo}</span>
                  </div>
                  <Show when={d().branch}>
                    <div class="flex justify-between border-t border-border/20 pt-1 mt-1">
                      <span class="text-muted-foreground">Branch:</span>
                      <span class="text-foreground">{d().branch}</span>
                    </div>
                  </Show>
                  <Show when={d().tag}>
                    <div class="flex justify-between border-t border-border/20 pt-1 mt-1">
                      <span class="text-muted-foreground">Tag:</span>
                      <span class="text-foreground">{d().tag}</span>
                    </div>
                  </Show>
                  <Show when={d().commit}>
                    <div class="flex justify-between border-t border-border/20 pt-1 mt-1">
                      <span class="text-muted-foreground">Commit:</span>
                      <span class="text-foreground">{d().commit}</span>
                    </div>
                  </Show>
                </div>

                <div class="flex items-center justify-between border-y border-muted/20 py-2">
                  <span class="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                    {d().entries.length} plugin(s)
                  </span>
                  <div class="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={selectAll}
                      disabled={props.busy}
                      class="h-7 px-2 text-[10px] font-bold"
                    >
                      {props.t("pluginsDashboard.monorepoPickerSelectAll")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={selectNone}
                      disabled={props.busy}
                      class="h-7 px-2 text-[10px] font-bold"
                    >
                      {props.t("pluginsDashboard.monorepoPickerSelectNone")}
                    </Button>
                  </div>
                </div>

                <div class="max-h-72 overflow-y-auto rounded border border-muted/40 divide-y divide-muted/30">
                  <For each={d().entries}>
                    {(entry) => (
                      <label
                        class="flex items-start gap-3 p-3 cursor-pointer hover:bg-muted/15 transition-colors"
                        class:opacity-60={entry.existing}
                      >
                        <Checkbox
                          checked={selected().has(entry.id)}
                          disabled={props.busy || entry.existing}
                          onChange={() => toggle(entry.id)}
                          class="pt-0.5"
                        />
                        <div class="min-w-0 flex-1">
                          <div class="flex items-center gap-2 flex-wrap">
                            <span class="text-xs font-bold text-foreground">
                              {entry.name || entry.id}
                            </span>
                            <Show when={entry.version}>
                              <span class="rounded bg-muted/40 px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground border border-muted/30">
                                v{entry.version}
                              </span>
                            </Show>
                            <Show when={entry.category}>
                              <span class="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary uppercase font-mono tracking-wider">
                                {entry.category}
                              </span>
                            </Show>
                            <Show when={entry.existing}>
                              <span class="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold text-emerald-500 uppercase font-mono tracking-wider">
                                {props.t("pluginsDashboard.monorepoPickerAlreadyInstalled")}
                              </span>
                            </Show>
                          </div>
                          <Show when={entry.description}>
                            <p class="text-[11px] text-muted-foreground/80 mt-1 leading-normal">
                              {entry.description}
                            </p>
                          </Show>
                          <Show when={!entry.description}>
                            <p class="text-[11px] text-muted-foreground/50 mt-1 italic">
                              id: {entry.id}
                            </p>
                          </Show>
                        </div>
                      </label>
                    )}
                  </For>
                </div>

                <p class="text-[10px] text-amber-500 font-medium leading-normal">
                  {props.t("pluginsDashboard.monorepoPickerWarning")}
                </p>
              </div>

              <DialogFooter>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={props.onCancel}
                  disabled={props.busy}
                >
                  {props.t("common.cancel")}
                </Button>
                <Button
                  size="sm"
                  onClick={handleInstall}
                  disabled={props.busy || selectedCount() === 0}
                >
                  {installLabel()}
                </Button>
              </DialogFooter>
            </>
          )}
        </Show>
      </DialogContent>
    </Dialog>
  );
};
