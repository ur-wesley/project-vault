import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { toast } from "solid-sonner";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { formatBytes } from "~/lib/format-bytes";
import { formatRelativeTime } from "~/lib/format-date";
import { useI18n } from "~/lib/i18n-context";
import { cn } from "~/lib/utils";
import {
  DEFAULT_CLEANER_THRESHOLDS,
  loadCleanerThresholds,
  saveCleanerThresholds,
  type ProjectCleanerThresholds,
} from "../lib/project-cleaner-settings";
import { projectCleanerExecute, projectCleanerScan } from "~/services/tauri/project-cleaner";
import type {
  ProjectCleanerActionKind,
  ProjectCleanerCategory,
  ProjectCleanerRow,
} from "~/types/dto";

const CATEGORY_ORDER: ProjectCleanerCategory[] = [
  "git_clean",
  "git_dirty",
  "no_git",
  "missing",
  "protected",
  "active",
];

const ACTION_KINDS: ProjectCleanerActionKind[] = ["skip", "clean", "delete", "unvault"];

const actionSelectClass =
  "h-8 w-full min-w-0 max-w-[11rem] cursor-pointer rounded-md border border-input bg-background px-2 text-xs text-foreground ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50";

function ActionSelect(props: {
  value: ProjectCleanerActionKind;
  onChange: (value: ProjectCleanerActionKind) => void;
  disabled?: boolean;
  labelFor: (action: ProjectCleanerActionKind) => string;
  class?: string;
  "aria-label"?: string;
}) {
  return (
    <select
      class={cn(actionSelectClass, props.class)}
      value={props.value}
      disabled={props.disabled}
      aria-label={props["aria-label"]}
      onChange={(e) => props.onChange(e.currentTarget.value as ProjectCleanerActionKind)}
    >
      <For each={ACTION_KINDS}>
        {(kind) => <option value={kind}>{props.labelFor(kind)}</option>}
      </For>
    </select>
  );
}

function SetAllActionSelect(props: {
  onChange: (value: ProjectCleanerActionKind) => void;
  disabled?: boolean;
  labelFor: (action: ProjectCleanerActionKind) => string;
  placeholder: string;
  class?: string;
}) {
  return (
    <select
      class={cn(actionSelectClass, props.class)}
      disabled={props.disabled}
      aria-label={props.placeholder}
      onChange={(e) => {
        const value = e.currentTarget.value as ProjectCleanerActionKind;
        if (!value) return;
        props.onChange(value);
        e.currentTarget.selectedIndex = 0;
      }}
    >
      <option value="" disabled selected>
        {props.placeholder}
      </option>
      <For each={ACTION_KINDS}>
        {(kind) => <option value={kind}>{props.labelFor(kind)}</option>}
      </For>
    </select>
  );
}

type LocationProjectCleanerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationId: string;
  locationName: string;
  onComplete: () => void;
};

export function LocationProjectCleanerDialog(props: LocationProjectCleanerDialogProps) {
  const { t, localeCode } = useI18n();
  const [scanning, setScanning] = createSignal(false);
  const [executing, setExecuting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [rows, setRows] = createSignal<ProjectCleanerRow[]>([]);
  const [actions, setActions] = createSignal<Record<string, ProjectCleanerActionKind>>({});
  const [thresholds, setThresholds] = createSignal<ProjectCleanerThresholds>(
    DEFAULT_CLEANER_THRESHOLDS,
  );
  const [deleteConfirmOpen, setDeleteConfirmOpen] = createSignal(false);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    try {
      await saveCleanerThresholds(thresholds());
      const r = await projectCleanerScan({
        locationId: props.locationId,
        unusedDays: thresholds().unusedDays,
        protectRecentDays: thresholds().protectRecentDays,
        protectFavorites: thresholds().protectFavorites,
        minPlaytimeMs: thresholds().minPlaytimeMs,
      });
      if (r.isErr()) {
        setError(r.error.message);
        return;
      }
      setRows(r.value.rows);
      const initial: Record<string, ProjectCleanerActionKind> = {};
      for (const row of r.value.rows) {
        initial[row.projectId] = row.suggestedAction;
      }
      setActions(initial);
    } finally {
      setScanning(false);
    }
  };

  createEffect(() => {
    if (props.open) {
      void (async () => {
        const loaded = await loadCleanerThresholds();
        setThresholds(loaded);
        await runScan();
      })();
    } else {
      setRows([]);
      setActions({});
      setError(null);
    }
  });

  const grouped = createMemo(() => {
    const map = new Map<ProjectCleanerCategory, ProjectCleanerRow[]>();
    for (const cat of CATEGORY_ORDER) {
      map.set(cat, []);
    }
    for (const row of rows()) {
      const list = map.get(row.category) ?? [];
      list.push(row);
      map.set(row.category, list);
    }
    return CATEGORY_ORDER.map((cat) => ({ category: cat, rows: map.get(cat) ?? [] })).filter(
      (g) => g.rows.length > 0,
    );
  });

  const stats = createMemo(() => {
    let cleanCount = 0;
    let deleteCount = 0;
    let unvaultCount = 0;
    let reclaimable = 0;
    for (const row of rows()) {
      const action = actions()[row.projectId] ?? row.suggestedAction;
      if (action === "clean") {
        cleanCount += 1;
        reclaimable += row.reclaimableBytes;
      } else if (action === "delete") {
        deleteCount += 1;
      } else if (action === "unvault") {
        unvaultCount += 1;
      }
    }
    return { cleanCount, deleteCount, unvaultCount, reclaimable };
  });

  const setAction = (projectId: string, action: ProjectCleanerActionKind) => {
    setActions((prev) => ({ ...prev, [projectId]: action }));
  };

  const setCategoryAction = (category: ProjectCleanerCategory, action: ProjectCleanerActionKind) => {
    setActions((prev) => {
      const next = { ...prev };
      for (const row of rows()) {
        if (row.category === category) {
          next[row.projectId] = action;
        }
      }
      return next;
    });
  };

  const executePlan = async () => {
    setExecuting(true);
    setError(null);
    try {
      const plan = rows().map((row) => ({
        projectId: row.projectId,
        action: actions()[row.projectId] ?? row.suggestedAction,
      }));
      const r = await projectCleanerExecute({ actions: plan });
      if (r.isErr()) {
        setError(r.error.message);
        return;
      }
      const result = r.value;
      if (result.failed.length > 0) {
        setError(
          result.failed.map((f) => `${f.projectId}: ${f.error}`).join("\n"),
        );
      }
      toast.success(
        t("locations.cleanerExecuteSuccess", {
          count: result.succeeded,
          bytes: formatBytes(result.bytesReclaimed),
        }) as string,
      );
      props.onComplete();
      props.onOpenChange(false);
    } finally {
      setExecuting(false);
      setDeleteConfirmOpen(false);
    }
  };

  const onApply = () => {
    if (stats().deleteCount > 0) {
      setDeleteConfirmOpen(true);
      return;
    }
    void executePlan();
  };

  const categoryLabel = (cat: ProjectCleanerCategory) =>
    t(`locations.cleanerCategory.${cat}`) as string;

  const actionLabel = (action: ProjectCleanerActionKind) =>
    t(`locations.cleanerAction.${action}`) as string;

  return (
    <>
      <Dialog open={props.open} onOpenChange={props.onOpenChange}>
        <DialogContent class="flex max-h-[90vh] max-w-4xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader class="border-b border-border/60 px-6 py-4">
            <DialogTitle class="text-sm font-bold">
              {t("locations.cleanerTitle", { name: props.locationName }) as string}
            </DialogTitle>
            <DialogDescription class="text-xs">
              {t("locations.cleanerDescription") as string}
            </DialogDescription>
          </DialogHeader>

          <div class="flex flex-wrap items-end gap-3 border-b border-border/40 bg-muted/10 px-6 py-3">
            <label class="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {t("locations.cleanerUnusedDays") as string}
              <input
                type="number"
                min={1}
                class="h-8 w-20 rounded-md border border-input bg-background px-2 text-xs"
                value={thresholds().unusedDays}
                disabled={scanning() || executing()}
                onInput={(e) =>
                  setThresholds((t) => ({
                    ...t,
                    unusedDays: Number.parseInt(e.currentTarget.value, 10) || 1,
                  }))
                }
              />
            </label>
            <label class="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {t("locations.cleanerProtectRecentDays") as string}
              <input
                type="number"
                min={0}
                class="h-8 w-20 rounded-md border border-input bg-background px-2 text-xs"
                value={thresholds().protectRecentDays}
                disabled={scanning() || executing()}
                onInput={(e) =>
                  setThresholds((t) => ({
                    ...t,
                    protectRecentDays: Number.parseInt(e.currentTarget.value, 10) || 0,
                  }))
                }
              />
            </label>
            <label class="flex items-center gap-2 pb-1 text-xs text-muted-foreground">
              <Checkbox
                checked={thresholds().protectFavorites}
                disabled={scanning() || executing()}
                onChange={(checked) =>
                  setThresholds((t) => ({ ...t, protectFavorites: checked }))
                }
              />
              {t("locations.cleanerProtectFavorites") as string}
            </label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="ml-auto h-8 text-xs"
              disabled={scanning() || executing()}
              onClick={() => void runScan()}
            >
              <Show
                when={scanning()}
                fallback={
                  <span class="iconify mdi--refresh me-1.5 h-3.5 w-3.5" aria-hidden="true" />
                }
              >
                <span class="iconify mdi--loading me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              </Show>
              {t("locations.cleanerRescan") as string}
            </Button>
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <Show when={error()}>
              <p class="mb-3 whitespace-pre-wrap rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error()}
              </p>
            </Show>
            <Show when={scanning() && rows().length === 0}>
              <p class="text-sm text-muted-foreground">{t("locations.cleanerScanning") as string}</p>
            </Show>
            <Show when={!scanning() && rows().length === 0}>
              <p class="text-sm text-muted-foreground">{t("locations.cleanerEmpty") as string}</p>
            </Show>
            <div class="flex flex-col gap-6">
              <For each={grouped()}>
                {(group) => (
                  <section>
                    <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div class="flex items-center gap-2">
                        <span
                          class={cn(
                            "rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                            group.category === "git_clean" && "bg-emerald-500/15 text-emerald-600",
                            group.category === "git_dirty" && "bg-amber-500/15 text-amber-600",
                            group.category === "no_git" && "bg-blue-500/15 text-blue-600",
                            group.category === "missing" && "bg-orange-500/15 text-orange-600",
                            group.category === "protected" && "bg-muted text-muted-foreground",
                            group.category === "active" && "bg-violet-500/15 text-violet-600",
                          )}
                        >
                          {categoryLabel(group.category)} ({group.rows.length})
                        </span>
                      </div>
                      <SetAllActionSelect
                        disabled={executing()}
                        labelFor={actionLabel}
                        placeholder={t("locations.cleanerSetAllLabel") as string}
                        class="w-[11rem]"
                        onChange={(action) => setCategoryAction(group.category, action)}
                      />
                    </div>
                    <div class="rounded-lg border border-border/60">
                      <table class="w-full table-fixed text-left text-xs">
                        <thead class="bg-muted/30 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          <tr>
                            <th class="px-3 py-2">{t("locations.projectColumn") as string}</th>
                            <th class="px-3 py-2">{t("locations.cleanerLastOpened") as string}</th>
                            <th class="px-3 py-2">{t("locations.sizeColumn") as string}</th>
                            <th class="px-3 py-2">{t("locations.cleanerReclaimable") as string}</th>
                            <th class="w-[12rem] px-3 py-2">{t("locations.cleanerActionColumn") as string}</th>
                          </tr>
                        </thead>
                        <tbody>
                          <For each={group.rows}>
                            {(row) => {
                              const currentAction = () =>
                                actions()[row.projectId] ?? row.suggestedAction;
                              const warnDirty = () =>
                                row.category === "git_dirty" &&
                                currentAction() !== "skip";
                              return (
                                <tr class="border-t border-border/40 hover:bg-muted/10">
                                  <td class="px-3 py-2">
                                    <div class="font-semibold text-foreground">{row.name}</div>
                                    <div class="truncate font-mono text-[10px] text-muted-foreground">
                                      {row.stack}
                                      <Show when={row.gitBranch}>
                                        {" · "}
                                        {row.gitBranch}
                                      </Show>
                                    </div>
                                  </td>
                                  <td class="px-3 py-2 tabular-nums text-muted-foreground">
                                    {row.lastOpenedAtMs
                                      ? formatRelativeTime(row.lastOpenedAtMs, localeCode()) ??
                                        "—"
                                      : "—"}
                                  </td>
                                  <td class="px-3 py-2 tabular-nums">{formatBytes(row.sizeBytes)}</td>
                                  <td class="px-3 py-2 tabular-nums">
                                    {formatBytes(row.reclaimableBytes)}
                                  </td>
                                  <td class="px-3 py-2">
                                    <div class="flex w-[12rem] items-center gap-1.5">
                                      <ActionSelect
                                        value={currentAction()}
                                        disabled={executing()}
                                        labelFor={actionLabel}
                                        class={cn(warnDirty() && "border-amber-500/60")}
                                        aria-label={t("locations.cleanerActionColumn") as string}
                                        onChange={(action) => setAction(row.projectId, action)}
                                      />
                                      <Show when={warnDirty()}>
                                        <span
                                          class="iconify mdi--alert-outline h-4 w-4 text-amber-500"
                                          title={t("locations.cleanerDirtyWarning") as string}
                                          aria-hidden="true"
                                        />
                                      </Show>
                                    </div>
                                  </td>
                                </tr>
                              );
                            }}
                          </For>
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
              </For>
            </div>
          </div>

          <DialogFooter class="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-6 py-4">
            <p class="text-xs text-muted-foreground">
              {t("locations.cleanerSummary", {
                clean: stats().cleanCount,
                delete: stats().deleteCount,
                unvault: stats().unvaultCount,
                bytes: formatBytes(stats().reclaimable),
              }) as string}
            </p>
            <div class="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={executing()}
                onClick={() => props.onOpenChange(false)}
              >
                {t("common.cancel") as string}
              </Button>
              <Button
                type="button"
                disabled={scanning() || executing() || rows().length === 0}
                onClick={() => onApply()}
              >
                <Show when={executing()}>
                  <span class="iconify mdi--loading me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                </Show>
                {t("locations.cleanerApply") as string}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteConfirmOpen()} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("locations.cleanerDeleteTitle") as string}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("locations.cleanerDeleteDescription", { count: stats().deleteCount }) as string}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul class="max-h-40 overflow-y-auto text-xs font-mono text-muted-foreground">
            <For each={rows().filter((r) => (actions()[r.projectId] ?? r.suggestedAction) === "delete")}>
              {(row) => <li class="truncate py-0.5">{row.path}</li>}
            </For>
          </ul>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
              {t("common.cancel") as string}
            </Button>
            <Button variant="destructive" onClick={() => void executePlan()}>
              {t("locations.cleanerDeleteConfirm") as string}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
