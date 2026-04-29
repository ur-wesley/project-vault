import { type Component } from "solid-js";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { useI18n } from "~/lib/i18n-context";
import { LocationManager } from "../LocationManager";

export type LocationManagerDialogProps = Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>;

export const LocationManagerDialog: Component<LocationManagerDialogProps> = (props) => {
  const { t } = useI18n();
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent class="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <span
              class="iconify mdi--folder-multiple-outline h-5 w-5 shrink-0 text-primary"
              aria-hidden="true"
            />
            {t("locations.title") as string}
          </DialogTitle>
        </DialogHeader>
        <div class="py-2">
          <LocationManager />
        </div>
      </DialogContent>
    </Dialog>
  );
};
