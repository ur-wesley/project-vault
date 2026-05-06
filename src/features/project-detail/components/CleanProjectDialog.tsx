import { For, Show, createSignal } from "solid-js";
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
import { useI18n } from "~/lib/i18n-context";
import { formatBytes } from "~/lib/format-bytes";
import { cn } from "~/lib/utils";
import type { GitCleanPreviewDto } from "~/types/dto";
import type { ProjectDetailModel } from "../model/createProjectDetailModel";

export function CleanProjectDialog(props: {
  model: ProjectDetailModel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const m = () => props.model;
  const [cleanPreview, setCleanPreview] = createSignal<GitCleanPreviewDto | null>(null);
  const [cleanSelected, setCleanSelected] = createSignal<Set<string>>(new Set<string>());
  const [cleanResetTracked, setCleanResetTracked] = createSignal(false);

  const onOpen = async () => {
    setCleanPreview(null);
    setCleanSelected(new Set());
    setCleanResetTracked(false);
    try {
      const result = await m().cleanPreview();
      setCleanPreview(result);
      setCleanSelected(new Set(result.entries.map((e) => e.path)));
    } catch {
      /* onError in mutation handles toast */
    }
  };

  return (
    <AlertDialog
      open={props.open}
      onOpenChange={(v) => {
        props.onOpenChange(v);
        if (!v) {
          setCleanPreview(null);
          setCleanSelected(new Set());
          setCleanResetTracked(false);
        } else {
          void onOpen();
        }
      }}
    >
      <AlertDialogContent class="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("projectDetail.cleanProjectTitle") as string}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("projectDetail.cleanProjectDescription") as string}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div class="max-h-60 overflow-y-auto rounded-md border border-border/40 bg-muted/20">
          <Show
            when={cleanPreview()}
            fallback={
              <div class="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <span class="iconify mdi--loading animate-spin size-4" />
                {t("projectDetail.cleanLoading") as string}
              </div>
            }
          >
            {(preview) => (
              <Show
                when={preview().entries.length > 0}
                fallback={
                  <div class="py-8 text-center text-sm text-muted-foreground">
                    {t("projectDetail.cleanNoFiles") as string}
                  </div>
                }
              >
                <For each={preview().entries}>
                  {(entry) => {
                    const isChild = preview().entries.some(
                      (e) =>
                        e.isDir &&
                        !cleanSelected().has(e.path) &&
                        entry.path !== e.path &&
                        entry.path.startsWith(e.path + "/"),
                    );
                    return (
                      <div
                        class={cn(
                          "flex items-center justify-between gap-2 border-b border-border/20 px-3 py-1.5 last:border-b-0",
                          isChild && "opacity-40",
                        )}
                      >
                        <div class="flex min-w-0 items-center gap-2">
                          <Checkbox
                            checked={cleanSelected().has(entry.path)}
                            disabled={isChild}
                            onChange={(checked) => {
                              setCleanSelected((prev) => {
                                const next = new Set(prev);
                                checked
                                  ? next.add(entry.path)
                                  : next.delete(entry.path);
                                return next;
                              });
                            }}
                          />
                          <span
                            class={cn(
                              "iconify size-3.5 shrink-0",
                              entry.isDir
                                ? "mdi--folder text-yellow-500"
                                : "mdi--file text-muted-foreground",
                            )}
                          />
                          <span class="truncate font-mono text-xs">
                            {entry.path}
                          </span>
                        </div>
                        <span class="shrink-0 font-mono text-[10px] text-muted-foreground">
                          {formatBytes(entry.sizeBytes)}
                        </span>
                      </div>
                    );
                  }}
                </For>
              </Show>
            )}
          </Show>
        </div>
        <Show when={cleanPreview()?.entries && cleanPreview()!.entries.length > 0}>
          <div class="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm font-medium">
            <span>
              {(() => {
                const selectedCount = cleanSelected().size;
                return t("projectDetail.cleanTotal", { count: selectedCount }) as string;
              })()}
            </span>
            <span class="font-mono">
              {formatBytes(
                cleanPreview()!.entries
                  .filter((e) => cleanSelected().has(e.path))
                  .reduce((sum, e) => sum + e.sizeBytes, 0),
              )}
            </span>
          </div>
        </Show>
        <Show when={cleanPreview()?.hasTrackedChanges}>
          <div class="flex items-center gap-2 pt-1">
            <Checkbox
              id="clean-reset-tracked"
              checked={cleanResetTracked()}
              onChange={setCleanResetTracked}
            />
            <label
              for="clean-reset-tracked"
              class="cursor-pointer text-xs text-muted-foreground"
            >
              {t("projectDetail.cleanResetTracked") as string}
            </label>
          </div>
        </Show>
        <AlertDialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            {t("wizard.cancel") as string}
          </Button>
          <Button
            variant="destructive"
            disabled={cleanSelected().size === 0 || m().isCleaning()}
            onClick={() => {
              props.onOpenChange(false);
              m().cleanExecute({
                resetTracked: cleanResetTracked(),
                selectedPaths: Array.from(cleanSelected()),
              });
            }}
          >
            <Show
              when={m().isCleaning()}
              fallback={<span class="iconify mdi--broom size-3.5" />}
            >
              <span class="iconify mdi--loading animate-spin size-3.5" />
            </Show>
            {t("projectDetail.cleanConfirm") as string}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
