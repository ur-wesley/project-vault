import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { ProjectSizeTreemap } from "./ProjectSizeTreemap";

type SizeTreemapDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationName: string;
  projects: { projectId: string; path: string; name: string; sizeBytes: number }[];
};

export function SizeTreemapDialog(props: SizeTreemapDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent class="max-w-2xl">
        <DialogHeader>
          <DialogTitle class="text-sm font-bold">
            Storage Breakdown — {props.locationName}
          </DialogTitle>
        </DialogHeader>
        <ProjectSizeTreemap projects={props.projects} />
      </DialogContent>
    </Dialog>
  );
}
