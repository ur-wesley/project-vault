import { Show, createSignal } from "solid-js";
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
import type { ProjectDetailModel } from "../model/createProjectDetailModel";

export function DeleteProjectDialog(props: {
  model: ProjectDetailModel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const [deleteFromDisk, setDeleteFromDisk] = createSignal(false);

  return (
    <AlertDialog
      open={props.open}
      onOpenChange={(v) => {
        props.onOpenChange(v);
        if (!v) setDeleteFromDisk(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("projectDetail.deleteProjectTitle") as string}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("projectDetail.deleteProjectDescription") as string}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div class="flex items-center gap-2 py-2">
          <Checkbox
            id="delete-from-disk"
            checked={deleteFromDisk()}
            onChange={setDeleteFromDisk}
          />
          <label
            for="delete-from-disk"
            class="cursor-pointer text-xs text-muted-foreground"
          >
            {t("projectDetail.deleteFromDisk") as string}
          </label>
        </div>
        <AlertDialogFooter>
          <Button
            variant="outline"
            onClick={() => props.onOpenChange(false)}
          >
            {t("wizard.cancel") as string}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              props.onOpenChange(false);
              props.model.deleteProject(props.model.props.projectId, deleteFromDisk());
            }}
          >
            {t("projectDetail.deleteConfirm") as string}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
