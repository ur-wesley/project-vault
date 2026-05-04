import { useQueryClient, createQuery } from "@tanstack/solid-query";
import { openPath } from "@tauri-apps/plugin-opener";
import { For, Show, createSignal, createMemo, type Component } from "solid-js";
import { listen } from "@tauri-apps/api/event";

import { Button } from "~/components/ui/button";
import { ButtonGroup } from "~/components/ui/button-group";

import { useEventHub } from "~/lib/event-hub-context";
import { useI18n } from "~/lib/i18n-context";
import { formatBytes } from "~/lib/format-bytes";
import { rescanAllLibraryFolders } from "~/lib/rescan-library";
import {
  addLocation,
  diskSpaceForPaths,
  listLocations,
  listProjects,
  pickLibraryFolder,
  removeLocation,
  scanLibraryLocation,
  updateLocation,
  importProject,
} from "~/services/tauri";
import { queryKeys } from "~/services/query-keys";
import type { LocationDto, MoveProjectProgress } from "~/types/dto";

import { LocationWorkProgress } from "./components/LocationWorkProgress";
import { LibraryLocationDiskBlock } from "./components/LibraryLocationDiskBlock";
import { LocationRenameDialog } from "./components/LocationRenameDialog";
import { LocationImportDialog } from "./components/LocationImportDialog";

type LocationWorkState =
  | { kind: "rescan"; locationId: string; locationName: string }
  | { kind: "add" }
  | { kind: "remove" }
  | { kind: "rename" }
  | { kind: "import"; source: string; destName: string };

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

  const projectsQ = createQuery(() => ({
    queryKey: queryKeys.projects,
    queryFn: async () => {
      const r = await listProjects();
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

  const locationProjectSize = createMemo(() => {
    const map = new Map<string, number>();
    for (const p of projectsQ.data ?? []) {
      map.set(p.locationId, (map.get(p.locationId) ?? 0) + p.sizeBytes);
    }
    return map;
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
      return (t("locations.rescanInProgress", { name: w.locationName }) as string);
    }
    if (w.kind === "add") {
      return t("locations.addInProgress") as string;
    }
    if (w.kind === "remove") {
      return t("locations.removeInProgress") as string;
    }
    if (w.kind === "import") {
        return (t('locations.importInProgress', { name: w.destName }) as string);
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
              window.alert(t('locations.importFailed', { message: r.error.message }) as string);
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
    if (!confirm(t("locations.removeConfirm") as string)) return;
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
          {t('locations.title') as string}
        </h3>
        <p class="text-xs text-muted-foreground">
          {t("locations.description") as string}
        </p>
      </div>

      <div class="flex flex-col gap-4">
        <Show when={work()}>{(w) => <LocationWorkProgress label={workLabel(w())} progress={workProgress()} />}</Show>
        <div class="flex flex-wrap gap-2">
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
          <Button
            type="button"
            variant="outline"
            class="w-full sm:w-auto bg-muted/20 border-border/60"
            disabled={busy()}
            onClick={async () => {
              setWork({ kind: "rescan", locationId: "all", locationName: t("locations.rescanAll") as string });
              try {
                const count = await rescanAllLibraryFolders();
                hub.emit("scan:complete", { projectCount: count });
                invalidateAll();
              } finally {
                setWork(null);
              }
            }}
          >
            <span class="iconify mdi--refresh me-1.5 h-4 w-4" aria-hidden="true" />
            {t("locations.rescanAll") as string}
          </Button>
        </div>
        
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
                <div class="mb-2 flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
                  <span class="iconify mdi--package-variant-closed h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden="true" />
                  <span class="font-medium">{t("locations.projectsSize") as string}:</span>
                  <span class="tabular-nums text-foreground/90">
                    {formatBytes(locationProjectSize().get(loc.id) ?? 0)}
                  </span>
                </div>
                <div class="mb-4">
                  <LibraryLocationDiskBlock
                    t={(k, a) => t(k, a) as string}
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
                    {t('common.open') as string}
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
                    {t('locations.rescan') as string}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    class="h-8 flex-1 text-[10px] font-bold uppercase tracking-tight bg-primary/10 text-primary hover:bg-primary/20"
                    disabled={busy()}
                    onClick={() => void openImport(loc.id)}
                  >
                    <span class="iconify mdi--import h-3.5 w-3.5 mr-1.5 shrink-0" aria-hidden="true" />
                    {t('common.import') as string}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    class="h-8 flex-1 text-[10px] font-bold uppercase tracking-tight text-muted-foreground hover:text-destructive hover:bg-destructive/5"
                    disabled={busy()}
                    onClick={() => void onRemove(loc.id)}
                  >
                    <span class="iconify mdi--delete-outline h-3.5 w-3.5 mr-1.5 shrink-0" aria-hidden="true" />
                    {t('common.remove') as string}
                  </Button>
                </ButtonGroup>
              </li>
            )}
          </For>
        </ul>
      </div>

      <LocationRenameDialog
        open={renameOpen()}
        onOpenChange={setRenameOpen}
        draft={renameDraft()}
        setDraft={setRenameDraft}
        onConfirm={commitRename}
        busy={busy()}
        t={(k) => t(k) as string}
      />

      <LocationImportDialog
        open={importOpen()}
        onOpenChange={setImportOpen}
        source={importSource()}
        deleteSource={importDeleteSource()}
        setDeleteSource={setImportDeleteSource}
        onConfirm={commitImport}
        t={(k) => t(k) as string}
      />
    </div>
  );
};
