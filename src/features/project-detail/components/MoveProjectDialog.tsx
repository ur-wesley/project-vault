import { Show, type Component } from "solid-js";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Select } from "~/components/ui/select";
import { useI18n } from "~/lib/i18n-context";

import type { ProjectDetailModel } from "../model/createProjectDetailModel";
import type { MoveLocationOption } from "../types";
import type { ProjectDto } from "~/types/dto";

type MoveProjectDialogProps = Readonly<{
  model: ProjectDetailModel;
  project: () => ProjectDto;
}>;

export const MoveProjectDialog: Component<MoveProjectDialogProps> = (props) => {
  const { t } = useI18n();
  const m = () => props.model;
  return (
    <Dialog
      open={m().moveOpen()}
      onOpenChange={(o) => {
        if (!o && m().moveBusy()) return;
        if (!o) m().resetMoveDialog();
      }}
    >
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("projectDetail.moveProjectTitle") as string}</DialogTitle>
          <DialogDescription>{m().moveDialogDescription()}</DialogDescription>
        </DialogHeader>
        <Show when={m().moveBusy()}>
          <div class="mb-4 space-y-3">
            <p class="text-sm font-medium text-foreground">{m().moveProgressPhaseLabel()}</p>
            <div class="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                class="h-full rounded-full bg-primary transition-[width] duration-150"
                style={{ width: `${m().moveProgressBarPercent()}%` }}
              />
            </div>
            <Show when={m().moveProgressFilesBytesLine()}>
              <p class="text-xs text-muted-foreground">{m().moveProgressFilesBytesLine()}</p>
            </Show>
          </div>
        </Show>
        <div
          classList={{
            "flex flex-col gap-2": true,
            "pointer-events-none opacity-50": m().moveBusy(),
          }}
        >
          <Show when={m().locsQ.isPending}>
            <p class="text-sm text-muted-foreground">{t("library.loading") as string}</p>
          </Show>
          <Show when={m().locsQ.isError}>
            <p class="text-sm text-destructive">{t("library.error") as string}</p>
          </Show>
          <Show
            when={
              !m().locsQ.isPending &&
              !m().locsQ.isError &&
              (m().moveLocationRows()?.length ?? 0) > 0
            }
          >
            <label class="text-xs text-muted-foreground" for="move-project-location">
              {t("projectDetail.moveProjectSelectLocation") as string}
            </label>
            <Select<MoveLocationOption>
              options={m().moveSelectOptions() as MoveLocationOption[]}
              optionValue="value"
              optionTextValue="textValue"
              optionDisabled="disabled"
              value={m().selectedMoveLocation()}
              onChange={(o) => {
                m().setMoveTargetLocationId(o?.value ?? null);
              }}
              disabled={m().moveBusy() || !m().hasMovableTarget()}
              placeholder={t("projectDetail.moveProjectPlaceholder") as string}
              itemComponent={(p) => (
                <Select.Item item={p.item}>
                  <Select.ItemLabel>{p.item.rawValue.label}</Select.ItemLabel>
                </Select.Item>
              )}
            >
              <Select.Trigger
                class="h-auto min-h-10 w-full py-2 text-left text-sm"
                id="move-project-location"
              >
                <Select.Value<MoveLocationOption>>
                  {(s) =>
                    s.selectedOption()?.label ??
                    (t("projectDetail.moveProjectPlaceholder") as string)
                  }
                </Select.Value>
              </Select.Trigger>
              <Select.Content>
                <Select.Listbox />
              </Select.Content>
            </Select>
          </Show>
          <Show
            when={
              !m().locsQ.isPending &&
              !m().locsQ.isError &&
              (m().moveLocationRows() ?? []).length === 0
            }
          >
            <p class="text-sm text-muted-foreground">
              {t("projectDetail.moveProjectNoLocations") as string}
            </p>
          </Show>
          <Show
            when={
              !m().locsQ.isPending &&
              !m().locsQ.isError &&
              (m().moveLocationRows() ?? []).length > 0 &&
              !m().hasMovableTarget()
            }
          >
            <p class="text-sm text-muted-foreground">
              {t("projectDetail.moveProjectAddAnotherLocation") as string}
            </p>
          </Show>
          <Show when={m().moveDestinationPreview()}>
            <p class="break-all text-xs text-muted-foreground">
              {t("projectDetail.moveProjectDestLabel") as string}: {m().moveDestinationPreview()}
            </p>
          </Show>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={m().moveBusy()}
            onClick={() => m().resetMoveDialog()}
          >
            {t("wizard.cancel") as string}
          </Button>
          <Button
            type="button"
            disabled={
              m().moveBusy() || m().moveTargetLocationId() == null || !m().hasMovableTarget()
            }
            onClick={() => void m().onConfirmMove(props.project())}
          >
            {m().moveBusy()
              ? (t("projectDetail.moveProjectBusy") as string)
              : (t("projectDetail.moveProjectRun") as string)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
