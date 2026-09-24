import { createEffect, createSignal } from "solid-js";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { useI18n } from "~/lib/i18n-context";

export type FileEntryRequest =
  | { kind: "newFile"; dirPath: string }
  | { kind: "newFolder"; dirPath: string }
  | { kind: "rename"; path: string; isDirectory: boolean }
  | { kind: "delete"; path: string; isDirectory: boolean };

function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

export function FileEntryDialog(props: {
  request: FileEntryRequest | null;
  onClose: () => void;
  onConfirm: (request: FileEntryRequest, value: string) => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  createEffect(() => {
    const request = props.request;
    if (!request) {
      setValue("");
      setBusy(false);
      return;
    }
    setValue(request.kind === "rename" ? baseName(request.path) : "");
    setBusy(false);
  });

  const isDelete = () => props.request?.kind === "delete";
  const isRename = () => props.request?.kind === "rename";
  const isFolderTarget = () =>
    props.request?.kind === "newFolder" ||
    (props.request?.kind === "rename" && props.request.isDirectory);

  const title = () => {
    switch (props.request?.kind) {
      case "newFile":
        return t("projectDetail.newFile") as string;
      case "newFolder":
        return t("projectDetail.newFolder") as string;
      case "rename":
        return t("projectDetail.renameEntry") as string;
      default:
        return "";
    }
  };

  const placeholder = () =>
    isFolderTarget()
      ? (t("projectDetail.newFolderPlaceholder") as string)
      : (t("projectDetail.newFilePlaceholder") as string);

  const confirmDisabled = () => busy() || (!isDelete() && value().trim().length === 0);

  const submit = () => {
    const request = props.request;
    if (!request) return;
    if (confirmDisabled()) return;
    setBusy(true);
    props.onConfirm(request, value().trim());
  };

  return (
    <>
      <Dialog
        open={props.request !== null && !isDelete()}
        onOpenChange={(open) => {
          if (!open) props.onClose();
        }}
      >
        <DialogContent class="max-w-md">
          <DialogHeader>
            <DialogTitle>{title()}</DialogTitle>
            <DialogDescription>
              {isRename()
                ? (t("projectDetail.renameDescription") as string)
                : (t("projectDetail.createDescription") as string)}
            </DialogDescription>
          </DialogHeader>
          <form
            class="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <label class="flex flex-col gap-1.5">
              <span class="text-xs font-medium text-muted-foreground">
                {t("projectDetail.entryName") as string}
              </span>
              <input
                ref={(el) => queueMicrotask(() => el.focus())}
                type="text"
                class="w-full rounded-md border border-border/60 bg-background px-2.5 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                placeholder={placeholder()}
                value={value()}
                onInput={(event) => setValue(event.currentTarget.value)}
              />
            </label>
            <DialogFooter class="gap-2">
              <Button type="button" variant="ghost" onClick={props.onClose}>
                {t("common.cancel") as string}
              </Button>
              <Button type="submit" disabled={confirmDisabled()}>
                {isRename() ? (t("common.save") as string) : (t("common.create") as string)}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={isDelete()}
        onOpenChange={(open) => {
          if (!open) props.onClose();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {
                t("projectDetail.deleteConfirmTitle", {
                  name:
                    props.request && "path" in props.request ? baseName(props.request.path) : "",
                }) as string
              }
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("projectDetail.deleteConfirmDescription") as string}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter class="gap-2">
            <Button variant="ghost" onClick={props.onClose}>
              {t("common.cancel") as string}
            </Button>
            <Button variant="destructive" disabled={busy()} onClick={submit}>
              {t("common.delete") as string}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
