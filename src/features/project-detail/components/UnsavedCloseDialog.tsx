import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { useI18n } from "~/lib/i18n-context";

import { baseNameOfPath } from "../lib/file-path-labels";
import type { FileTabsModel } from "../model/fileTabsModel";

/** Unsaved-changes stop for tab close. State lives in the model. */
export function UnsavedCloseDialog(props: { model: FileTabsModel }) {
  const { t } = useI18n();
  const pending = () => props.model.pendingClose();

  return (
    <AlertDialog
      open={pending() !== null}
      onOpenChange={(open) => {
        if (!open) props.model.cancelClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("projectDetail.unsavedChanges") as string}</AlertDialogTitle>
          <AlertDialogDescription>
            {
              t("projectDetail.unsavedChangesDescription", {
                name: pending() ? baseNameOfPath(pending()!) : "",
              }) as string
            }
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="ghost" onClick={() => props.model.cancelClose()}>
            {t("common.cancel") as string}
          </Button>
          <Button variant="outline" onClick={() => props.model.discardAndClose()}>
            {t("projectDetail.discardChanges") as string}
          </Button>
          <Button onClick={() => void props.model.saveAndClose()}>
            {t("projectDetail.saveAndClose") as string}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
