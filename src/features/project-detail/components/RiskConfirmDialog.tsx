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
import { useI18n } from "~/lib/i18n-context";
import type { ProjectDetailModel } from "../model/createProjectDetailModel";

type RiskConfirmDialogProps = Readonly<{
  model: ProjectDetailModel;
}>;

export const RiskConfirmDialog: Component<RiskConfirmDialogProps> = (props) => {
  const { t } = useI18n();
  const m = () => props.model;
  return (
    <Dialog open={m().risk() != null} onOpenChange={(o) => !o && m().setRisk(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("library.riskTitle") as string}</DialogTitle>
          <DialogDescription>{t("library.riskDescription") as string}</DialogDescription>
        </DialogHeader>
        <DialogFooter class="gap-2">
          <Button type="button" variant="outline" onClick={() => m().setRisk(null)}>
            {t("library.riskCancel") as string}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              const ctx = m().risk();
              m().setRisk(null);
              if (ctx) void m().runArgv(ctx.project, ctx.argv, true, ctx.cwd);
            }}
          >
            {t("library.riskConfirm") as string}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
