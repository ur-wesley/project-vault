import { createSignal, onCleanup, onMount, Show, For } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useNotificationCenter } from "~/lib/notification-store";
import { pluginStoreMirror } from "../store/pluginStore";
import { applyPluginViewPatch, upsertPluginViewPage } from "~/lib/plugin/plugin-pages";
import { isPlainObject } from "~/lib/guards";
import { parseViewSpec, parsePageActions } from "../types";
import type { PluginStoreChangedEvent } from "../types";
import { PluginTableView } from "../views/PluginTableView";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";

// ─── New-event bridge (kept separate from legacy PluginUiBridge) ────────────
// Handles: plugin:show-table, plugin:show-confirm, plugin:show-toast,
// plugin:set-view, plugin:store-changed. Mount once in App.tsx next to the
// legacy bridge; each listener is independently removable.

export function PluginUiExtensions() {
  const center = useNotificationCenter();
  const [tableDialog, setTableDialog] = createSignal<{
    id: string;
    title: string;
    columns: { id: string; header: string }[];
    rows: { id: string; cells: Record<string, unknown> }[];
  } | null>(null);
  const [confirmDialog, setConfirmDialog] = createSignal<{
    id: string;
    title: string;
    message?: string;
    okLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  } | null>(null);

  onMount(() => {
    const unlistens: (() => void)[] = [];
    void (async () => {
      unlistens.push(
        await listen<[string, { title: string; columns: never[]; rows: never[] }]>(
          "plugin:show-table",
          (event) => {
            const [id, options] = event.payload;
            setTableDialog({
              id,
              title: options.title,
              columns: options.columns as never as { id: string; header: string }[],
              rows: options.rows as never as {
                id: string;
                cells: Record<string, unknown>;
              }[],
            });
          },
        ),
      );
      unlistens.push(
        await listen<
          [string, { title: string; message?: string; okLabel?: string; cancelLabel?: string }]
        >("plugin:show-confirm", (event) => {
          const [id, options] = event.payload;
          setConfirmDialog({ id, ...options });
        }),
      );
      unlistens.push(
        await listen<{
          pluginId: string;
          title: string;
          message?: string;
          severity: "info" | "success" | "warn" | "error";
        }>("plugin:show-toast", (event) => {
          const e = event.payload;
          center.notify({
            severity: e.severity,
            title: e.title,
            body: e.message ?? "",
            durationMs: 4000,
          });
        }),
      );
      unlistens.push(
        await listen<{
          pluginId: string;
          id: string;
          title?: string;
          view?: unknown;
          patch?: unknown;
          partial?: boolean;
          actions?: unknown;
        }>("plugin:set-view", (event) => {
          const { pluginId, id, title, view, patch, partial, actions } = event.payload;
          try {
            if (partial) {
              const patchObj = isPlainObject(patch) ? patch : {};
              applyPluginViewPatch(pluginId, id, {
                ...patchObj,
                ...(title !== undefined ? { title } : {}),
              });
              return;
            }
            const parsed = isPlainObject(view) ? parseViewSpec(view) : undefined;
            upsertPluginViewPage({
              pluginId,
              id,
              title,
              kind: parsed?.kind,
              view: parsed as { kind: string; [k: string]: unknown } | undefined,
              actions: parsePageActions(actions),
            });
          } catch (err) {
            console.error("plugin:set-view: invalid view spec", err);
          }
        }),
      );
      unlistens.push(
        await listen<PluginStoreChangedEvent>("plugin:store-changed", (event) => {
          pluginStoreMirror.applyEvent(event.payload);
        }),
      );
    })();
    onCleanup(() => {
      for (const fn of unlistens) fn();
    });
  });

  const resolveTable = async (value: string | null) => {
    const cur = tableDialog();
    if (!cur) return;
    await invoke("resolve_plugin_ui", { id: cur.id, value });
    setTableDialog(null);
  };

  const resolveConfirm = async (value: boolean) => {
    const cur = confirmDialog();
    if (!cur) return;
    await invoke("resolve_plugin_ui", { id: cur.id, value });
    setConfirmDialog(null);
  };

  return (
    <>
      <Dialog open={!!tableDialog()} onOpenChange={(o) => !o && resolveTable(null)}>
        <DialogContent class="sm:max-w-[800px]">
          <DialogHeader>
            <DialogTitle>{tableDialog()?.title}</DialogTitle>
          </DialogHeader>
          <Show when={tableDialog()}>
            {(d) => (
              <PluginTableView
                spec={{
                  kind: "table",
                  // eslint-disable-next-line solid/no-reactivity-loss
                  columns: d().columns,
                  // eslint-disable-next-line solid/no-reactivity-loss
                  rows: d().rows,
                }}
                onRowClick={(rowId) => resolveTable(rowId)}
              />
            )}
          </Show>
          <DialogFooter>
            <Button variant="ghost" onClick={() => resolveTable(null)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmDialog()} onOpenChange={(o) => !o && resolveConfirm(false)}>
        <DialogContent class="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{confirmDialog()?.title}</DialogTitle>
          </DialogHeader>
          <Show when={confirmDialog()?.message}>
            <p class="py-2 text-xs text-muted-foreground">{confirmDialog()?.message}</p>
          </Show>
          <DialogFooter>
            <Button variant="ghost" onClick={() => resolveConfirm(false)}>
              {confirmDialog()?.cancelLabel ?? "Cancel"}
            </Button>
            <Button
              variant={confirmDialog()?.danger ? "destructive" : "default"}
              onClick={() => resolveConfirm(true)}
            >
              {confirmDialog()?.okLabel ?? "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hidden probe for tests: renders store keys count */}
      <For each={[] as string[]}>{() => <span />}</For>
    </>
  );
}
