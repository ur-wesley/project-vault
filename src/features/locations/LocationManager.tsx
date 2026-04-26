import { useQueryClient, createQuery } from "@tanstack/solid-query";
import { openPath } from "@tauri-apps/plugin-opener";
import { For, Show, createSignal, type Component } from "solid-js";
import { listen } from "@tauri-apps/api/event";

import { Button } from "~/components/ui/button";
import { ButtonGroup } from "~/components/ui/button-group";
import { Checkbox } from "~/components/ui/checkbox";
import { Label } from "~/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { TextField, TextFieldInput, TextFieldLabel } from "~/components/ui/text-field";
import { formatBytes } from "~/lib/format-bytes";
import { useEventHub } from "~/lib/event-hub-context";
import { useI18n } from "~/lib/i18n-context";
import {
  addLocation,
  diskSpaceForPaths,
  listLocations,
  pickLibraryFolder,
  removeLocation,
  scanLibraryLocation,
  updateLocation,
  importProject,
} from "~/services/tauri";
import { queryKeys } from "~/services/query-keys";
import type { LocationDto, PathDiskSpaceDto, MoveProjectProgress } from "~/types/dto";

type LocationWorkState =
  | { kind: "rescan"; locationId: string; locationName: string }
  | { kind: "add" }
  | { kind: "remove" }
  | { kind: "rename" }
  | { kind: "import"; source: string; destName: string };

function LocationWorkProgress(props: { label: string; progress?: MoveProjectProgress | null }) {
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
        <Show when={props.progress} fallback={
             <div class="pv-location-scan-indeterminate h-full w-1/3 max-w-[45%] rounded-full bg-primary/80" />
        }>
            <div 
                class="h-full bg-primary/80 transition-[width] duration-300" 
                style={{ width: `${Math.round((100 * props.progress!.filesDone) / props.progress!.filesTotal)}%` }} 
            />
        </Show>
      </div>
    </div>
  );
}

function LibraryLocationDiskBlock(props: {
  t: (key: string) => unknown;
  isPending: boolean;
  isError: boolean;
  row: PathDiskSpaceDto | undefined;
}) {
  const t = (k: string) => props.t(k) as string;
  if (props.isPending) {
    return <p class="text-xs text-muted-foreground">{t("library.loading")}</p>;
  }
  if (props.isError) {
    return <p class="text-xs text-destructive/90">{t("library.error")}</p>;
  }
  const row = props.row;
  if (row == null) {
    return <p class="text-xs text-muted-foreground">—</p>;
  }
  if (row.totalBytes === 0) {
    return <p class="text-xs text-muted-foreground">{t("locations.diskSpaceUnknown")}</p>;
  }
  const used = row.totalBytes - row.availableBytes;
  const usedPct = Math.max(0, Math.min(100, Math.round((100 * used) / row.totalBytes)));
  const barLabel = t("locations.diskVisBarDesc")
    .replace("{usedPercent}", `${usedPct}%`)
    .replace("{free}", formatBytes(row.availableBytes))
    .replace("{total}", formatBytes(row.totalBytes));
  return (
    <div class="space-y-2">
      <div
        class="h-2.5 w-full overflow-hidden rounded-full bg-muted/90 ring-1 ring-inset ring-border/40"
        role="img"
        aria-label={barLabel}
      >
        <div
          class="h-full min-w-0 rounded-full bg-primary/90 transition-[width]"
          style={{ width: `${usedPct}%` }}
        />
      </div>
      <div class="grid grid-cols-3 gap-2 text-[11px] leading-snug sm:text-xs">
        <div>
          <p class="flex items-center gap-1 font-medium text-muted-foreground">
            <span
              class="iconify mdi--thermometer-low h-3.5 w-3.5 shrink-0 opacity-80"
              aria-hidden="true"
            />
            {t("locations.diskVisFree")}
          </p>
          <p class="tabular-nums text-foreground/95">{formatBytes(row.availableBytes)}</p>
        </div>
        <div>
          <p class="flex items-center gap-1 font-medium text-muted-foreground">
            <span
              class="iconify mdi--chart-box-outline h-3.5 w-3.5 shrink-0 opacity-80"
              aria-hidden="true"
            />
            {t("locations.diskVisUsed")}
          </p>
          <p class="tabular-nums text-foreground/95">{formatBytes(used)}</p>
        </div>
        <div>
          <p class="flex items-center gap-1 font-medium text-muted-foreground">
            <span
              class="iconify mdi--harddisk h-3.5 w-3.5 shrink-0 opacity-80"
              aria-hidden="true"
            />
            {t("locations.diskVisTotal")}
          </p>
          <p class="tabular-nums text-foreground/95">{formatBytes(row.totalBytes)}</p>
        </div>
      </div>
    </div>
  );
}

export const LocationManager: Component = () => {
  const { t } = useI18n();
  const hub = useEventHub();
  const qc = useQueryClient();
  const [work, setWork] = createSignal<LocationWorkState | null>(null);
  const [workProgress, setWorkProgress] = createSignal<MoveProjectProgress | null>(null);
  const busy = () => work() != null;

  const [renameOpen, setRenameOpen] = createSignal(false);
  const [renameId, setRenameId] = createSignal<string | null>(null);
  const [renamePrevious, setRenamePrevious] = createSignal("");
  const [renameDraft, setRenameDraft] = createSignal("");

  const [importOpen, setImportOpen] = createSignal(false);
  const [importSource, setImportOpenSource] = createSignal("");
  const [importDestLocationId, setImportDestLocationId] = createSignal("");
  const [importDeleteSource, setImportDeleteSource] = createSignal(false);

  const locQ = createQuery(() => ({
    queryKey: queryKeys.locations,
    queryFn: async () => {
      const r = await listLocations();
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

  const diskQ = createQuery(() => {
    const locs = locQ.data ?? [];
    return {
      queryKey: queryKeys.locationDiskSpace(locs.map((l) => l.path).join("\0")),
      queryFn: async () => {
        if (locs.length === 0) return [];
        const r = await diskSpaceForPaths(locs.map((l) => l.path));
        if (r.isErr()) throw new Error(r.error.message);
        return r.value;
      },
      enabled: locQ.isSuccess && locs.length > 0,
      staleTime: 30_000,
    };
  });

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.locations });
    void qc.invalidateQueries({ queryKey: ["locations", "disk"] });
    void qc.invalidateQueries({ queryKey: queryKeys.projects });
  };

  const isRescanningLocation = (locationId: string) => {
    const s = work();
    return s != null && s.kind === "rescan" && s.locationId === locationId;
  };

  const workLabel = (w: LocationWorkState): string => {
    if (w.kind === "rescan") {
      return (t("locations.rescanInProgress") as string).replace("{name}", w.locationName);
    }
    if (w.kind === "add") {
      return t("locations.addInProgress") as string;
    }
    if (w.kind === "remove") {
      return t("locations.removeInProgress") as string;
    }
    if (w.kind === "import") {
        return `Importing ${w.destName}...`;
    }
    return t("locations.renameInProgress") as string;
  };

  const onAdd = async () => {
    const pick = await pickLibraryFolder();
    if (pick.isErr()) return;
    const path = pick.value;
    if (path == null) return;
    setWork({ kind: "add" });
    try {
      const added = await addLocation({ path });
      if (added.isErr()) return;
      const scan = await scanLibraryLocation(added.value.id);
      if (scan.isOk()) {
        hub.emit("scan:complete", {
          projectCount: scan.value.projectsUpserted,
          locationId: added.value.id,
        });
      }
      invalidateAll();
    } finally {
      setWork(null);
    }
  };

  const openImport = async (locId: string) => {
      const pick = await pickLibraryFolder();
      if (pick.isErr()) return;
      const path = pick.value;
      if (path == null) return;
      setImportOpenSource(path);
      setImportDestLocationId(locId);
      setImportDeleteSource(false);
      setImportOpen(true);
  };

  const commitImport = async () => {
      const src = importSource();
      const locId = importDestLocationId();
      const del = importDeleteSource();
      if (!src || !locId) return;

      const folderName = src.split(/[\\/]/).pop() || "project";
      setWork({ kind: "import", source: src, destName: folderName });
      setWorkProgress(null);
      setImportOpen(false);

      const unlisten = await listen<MoveProjectProgress>("import-project-progress", (e) => {
          setWorkProgress(e.payload);
      });

      try {
          const r = await importProject({
              sourcePath: src,
              destinationLocationId: locId,
              deleteSource: del
          });
          if (r.isOk()) {
              invalidateAll();
          } else {
              window.alert(`Import failed: ${r.error.message}`);
          }
      } finally {
          unlisten();
          setWork(null);
          setWorkProgress(null);
      }
  };

  const onRescan = async (location: LocationDto) => {
    setWork({ kind: "rescan", locationId: location.id, locationName: location.name });
    try {
      const scan = await scanLibraryLocation(location.id);
      if (scan.isOk()) {
        hub.emit("scan:complete", {
          projectCount: scan.value.projectsUpserted,
          locationId: location.id,
        });
      }
      invalidateAll();
    } finally {
      setWork(null);
    }
  };

  const onRemove = async (id: string) => {
    if (!confirm(t("locations.removeConfirm") as string || "Remove this location? Your projects will stay on disk but won't be visible in the library.")) return;
    setWork({ kind: "remove" });
    try {
      const r = await removeLocation(id);
      if (r.isOk()) invalidateAll();
    } finally {
      setWork(null);
    }
  };

  const openRenameDialog = (loc: LocationDto) => {
    setRenameId(loc.id);
    setRenamePrevious(loc.name);
    setRenameDraft(loc.name);
    setRenameOpen(true);
  };

  const commitRename = async () => {
    const id = renameId();
    if (id == null) return;
    const v = renameDraft().trim();
    const prev = renamePrevious();
    if (v.length === 0) return;
    if (v === prev) {
      setRenameOpen(false);
      return;
    }
    setWork({ kind: "rename" });
    try {
      const r = await updateLocation({ id, name: v });
      if (r.isOk()) invalidateAll();
    } finally {
      setWork(null);
    }
    setRenameOpen(false);
  };

  const onOpenInFileManager = async (path: string) => {
    try {
      await openPath(path);
    } catch (e) {
      window.alert(`${t("library.openInFileManagerFailed") as string} ${String(e)}`);
    }
  };

  const diskRowForPath = (path: string) => diskQ.data?.find((d) => d.path === path);

  return (
    <div class="flex flex-col gap-4">
      <div class="space-y-1">
        <h3 class="text-sm font-bold uppercase tracking-wider text-primary/80">
          Library Locations
        </h3>
        <p class="text-xs text-muted-foreground">
          {t("locations.description") as string}
        </p>
      </div>

      <div class="flex flex-col gap-4">
        <Show when={work()}>{(w) => <LocationWorkProgress label={workLabel(w())} progress={workProgress()} />}</Show>
        <Button
          type="button"
          variant="outline"
          class="w-full sm:w-auto bg-muted/20 border-border/60"
          disabled={busy()}
          onClick={() => void onAdd()}
        >
          <span class="iconify mdi--folder-plus me-1.5 h-4 w-4" aria-hidden="true" />
          {t("locations.add") as string}
        </Button>
        
        <Show when={locQ.isPending}>
          <p class="text-sm text-muted-foreground">{t("library.loading") as string}</p>
        </Show>
        <Show when={locQ.isSuccess && (locQ.data?.length ?? 0) === 0}>
          <p class="text-sm text-muted-foreground">{t("locations.empty") as string}</p>
        </Show>

        <ul class="flex flex-col gap-4">
          <For each={locQ.data ?? []}>
            {(loc) => (
              <li
                class="rounded-xl border border-border/80 bg-card p-4 shadow-sm"
                classList={{
                  "ring-2 ring-primary/35 ring-offset-1 ring-offset-background":
                    isRescanningLocation(loc.id),
                }}
              >
                <div class="mb-3 flex items-center gap-2">
                  <span
                    class="iconify mdi--folder-outline h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <p class="min-w-0 flex-1 truncate text-sm font-bold leading-tight">{loc.name}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    class="h-8 shrink-0 gap-1.5 px-2 text-[10px] font-bold uppercase tracking-tighter"
                    disabled={busy()}
                    onClick={() => openRenameDialog(loc)}
                  >
                    <span class="iconify mdi--pencil h-3.5 w-3.5" aria-hidden="true" />
                    {t("locations.rename") as string}
                  </Button>
                </div>
                <p class="mb-3 flex gap-1.5 break-all text-[11px] font-mono text-muted-foreground/80">
                  <span
                    class="iconify mdi--map-marker-radius-outline mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60"
                    aria-hidden="true"
                  />
                  <span class="line-clamp-2 min-w-0">{loc.path}</span>
                </p>
                <div class="mb-4">
                  <LibraryLocationDiskBlock
                    t={t}
                    isPending={diskQ.isPending}
                    isError={diskQ.isError}
                    row={diskRowForPath(loc.path)}
                  />
                </div>
                <ButtonGroup class="!flex w-full min-w-0 flex-row gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    class="h-8 flex-1 text-[10px] font-bold uppercase tracking-tight bg-muted/40"
                    disabled={busy()}
                    onClick={() => void onOpenInFileManager(loc.path)}
                  >
                    <span class="iconify mdi--folder-open h-3.5 w-3.5 mr-1.5 shrink-0" aria-hidden="true" />
                    Open
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    class="h-8 flex-1 text-[10px] font-bold uppercase tracking-tight bg-muted/40"
                    disabled={busy() || !loc.enabled}
                    onClick={() => void onRescan(loc)}
                  >
                    <Show
                      when={isRescanningLocation(loc.id)}
                      fallback={
                        <span class="iconify mdi--refresh h-3.5 w-3.5 mr-1.5 shrink-0" aria-hidden="true" />
                      }
                    >
                      <span class="iconify mdi--loading h-3.5 w-3.5 mr-1.5 shrink-0 animate-spin" aria-hidden="true" />
                    </Show>
                    Rescan
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    class="h-8 flex-1 text-[10px] font-bold uppercase tracking-tight bg-primary/10 text-primary hover:bg-primary/20"
                    disabled={busy()}
                    onClick={() => void openImport(loc.id)}
                  >
                    <span class="iconify mdi--import h-3.5 w-3.5 mr-1.5 shrink-0" aria-hidden="true" />
                    Import
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    class="h-8 flex-1 text-[10px] font-bold uppercase tracking-tight text-muted-foreground hover:text-destructive hover:bg-destructive/5"
                    disabled={busy()}
                    onClick={() => void onRemove(loc.id)}
                  >
                    <span class="iconify mdi--delete-outline h-3.5 w-3.5 mr-1.5 shrink-0" aria-hidden="true" />
                    Remove
                  </Button>
                </ButtonGroup>
              </li>
            )}
          </For>
        </ul>
      </div>

      <Dialog
        open={renameOpen()}
        onOpenChange={(o) => {
          if (!o) setRenameOpen(false);
        }}
      >
        <DialogContent class="sm:max-w-md">
          <DialogHeader>
            <DialogTitle class="flex items-center gap-2">
              <span
                class="iconify mdi--pencil-outline h-5 w-5 shrink-0 text-primary"
                aria-hidden="true"
              />
              {t("locations.renameDialogTitle") as string}
            </DialogTitle>
            <DialogDescription>
              {t("locations.renameDialogDescription") as string}
            </DialogDescription>
          </DialogHeader>
          <TextField>
            <TextFieldLabel for="location-rename-name">
              {t("locations.renameNameLabel") as string}
            </TextFieldLabel>
            <TextFieldInput
              id="location-rename-name"
              type="text"
              value={renameDraft()}
              onInput={(e) => setRenameDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void commitRename();
                }
              }}
              disabled={busy()}
              class="h-9"
              autofocus
              autocomplete="off"
            />
          </TextField>
          <DialogFooter class="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={busy()}
              onClick={() => setRenameOpen(false)}
            >
              {t("wizard.cancel") as string}
            </Button>
            <Button
              type="button"
              disabled={busy() || renameDraft().trim().length === 0}
              onClick={() => void commitRename()}
            >
              {t("locations.renameSave") as string}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={importOpen()}
        onOpenChange={(o) => {
          if (!o) setImportOpen(false);
        }}
      >
        <DialogContent class="sm:max-w-md">
          <DialogHeader>
            <DialogTitle class="flex items-center gap-2">
              <span
                class="iconify mdi--import h-5 w-5 shrink-0 text-primary"
                aria-hidden="true"
              />
              Import Project
            </DialogTitle>
            <DialogDescription>
              This will copy the project into the selected library location.
            </DialogDescription>
          </DialogHeader>
          
          <div class="space-y-4 py-4">
             <div class="space-y-1.5">
                <p class="text-[10px] uppercase font-black text-muted-foreground tracking-widest">Source Path</p>
                <div class="rounded-md bg-muted/40 border border-border/40 p-2 text-xs font-mono break-all">
                    {importSource()}
                </div>
             </div>

             <div class="flex items-start space-x-3">
                <Checkbox 
                  id="import-delete-source" 
                  checked={importDeleteSource()} 
                  onChange={(checked) => {
                    setImportDeleteSource(checked);
                  }}
                />
                <div class="grid gap-1.5 leading-none pt-0.5">
                  <Label
                    for="import-delete-source"
                    class="text-sm font-medium leading-none cursor-pointer"
                  >
                    Delete source folder after successful import
                  </Label>
                  <p class="text-xs text-muted-foreground">
                    Only recommended if you want to permanently move the project.
                  </p>
                </div>
              </div>
          </div>

          <DialogFooter class="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setImportOpen(false)}
            >
              {t("wizard.cancel") as string}
            </Button>
            <Button
              type="button"
              onClick={() => void commitImport()}
            >
              Start Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function LocationManagerDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent class="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <span
              class="iconify mdi--folder-multiple-outline h-5 w-5 shrink-0 text-primary"
              aria-hidden="true"
            />
            Locations
          </DialogTitle>
        </DialogHeader>
        <div class="py-2">
            <LocationManager />
        </div>
      </DialogContent>
    </Dialog>
  );
}
