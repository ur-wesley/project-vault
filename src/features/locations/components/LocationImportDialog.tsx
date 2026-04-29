import { type Component } from "solid-js";
import { Button } from "~/components/ui/button";
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

export type LocationImportDialogProps = Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: string;
  deleteSource: boolean;
  setDeleteSource: (v: boolean) => void;
  onConfirm: () => void;
  t: (key: string) => string;
}>;

export const LocationImportDialog: Component<LocationImportDialogProps> = (props) => {
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <span
              class="iconify mdi--import h-5 w-5 shrink-0 text-primary"
              aria-hidden="true"
            />
            {props.t('locations.importTitle')}
          </DialogTitle>
          <DialogDescription>
            {props.t('locations.importDescription')}
          </DialogDescription>
        </DialogHeader>
        
        <div class="space-y-4 py-4">
           <div class="space-y-1.5">
              <p class="text-[10px] uppercase font-black text-muted-foreground tracking-widest">{props.t('locations.importSourcePath')}</p>
              <div class="rounded-md bg-muted/40 border border-border/40 p-2 text-xs font-mono break-all">
                  {props.source}
              </div>
           </div>

           <div class="flex items-start space-x-3">
              <Checkbox 
                id="import-delete-source" 
                checked={props.deleteSource} 
                onChange={(checked) => {
                  props.setDeleteSource(checked);
                }}
              />
              <div class="grid gap-1.5 leading-none pt-0.5">
                <Label
                  for="import-delete-source"
                  class="text-sm font-medium leading-none cursor-pointer"
                >
                  {props.t('locations.importDeleteSource')}
                </Label>
                <p class="text-xs text-muted-foreground">
                  {props.t('locations.importDeleteSourceHint')}
                </p>
              </div>
            </div>
        </div>

        <DialogFooter class="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => props.onOpenChange(false)}
          >
            {props.t("wizard.cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => props.onConfirm()}
          >
            {props.t('locations.importRun')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
