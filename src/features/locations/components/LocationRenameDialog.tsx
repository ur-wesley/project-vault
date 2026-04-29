import { type Component } from "solid-js";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { TextField, TextFieldInput, TextFieldLabel } from "~/components/ui/text-field";

export type LocationRenameDialogProps = Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: string;
  setDraft: (v: string) => void;
  onConfirm: () => void;
  busy: boolean;
  t: (key: string) => string;
}>;

export const LocationRenameDialog: Component<LocationRenameDialogProps> = (props) => {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <span
              class="iconify mdi--pencil-outline h-5 w-5 shrink-0 text-primary"
              aria-hidden="true"
            />
            {props.t("locations.renameDialogTitle")}
          </DialogTitle>
          <DialogDescription>
            {props.t("locations.renameDialogDescription")}
          </DialogDescription>
        </DialogHeader>
        <TextField>
          <TextFieldLabel for="location-rename-name">
            {props.t("locations.renameNameLabel")}
          </TextFieldLabel>
          <TextFieldInput
            id="location-rename-name"
            type="text"
            value={props.draft}
            onInput={(e) => props.setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                props.onConfirm();
              }
            }}
            disabled={props.busy}
            class="h-9"
            autofocus
            autocomplete="off"
          />
        </TextField>
        <DialogFooter class="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            disabled={props.busy}
            onClick={() => props.onOpenChange(false)}
          >
            {props.t("wizard.cancel")}
          </Button>
          <Button
            type="button"
            disabled={props.busy || props.draft.trim().length === 0}
            onClick={() => props.onConfirm()}
          >
            {props.t("locations.renameSave")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
