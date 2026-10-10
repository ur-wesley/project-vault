import { createSignal, type Component } from "solid-js";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { TextField, TextFieldInput, TextFieldTextArea } from "~/components/ui/text-field";
import { useI18n } from "~/lib/i18n-context";
import { BEADS_ISSUE_TYPES, PRIORITY_MAP } from "./types";

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: {
    title: string;
    issueType: string;
    priority: number;
    description?: string;
  }) => void;
  isSubmitting?: boolean;
};

export const BeadCreateDialog: Component<Props> = (props) => {
  const { t } = useI18n();

  const [title, setTitle] = createSignal("");
  const [issueType, setIssueType] = createSignal("task");
  const [priority, setPriority] = createSignal(2);
  const [description, setDescription] = createSignal("");

  const handleSubmit = (e?: Event) => {
    e?.preventDefault();
    const tVal = title().trim();
    if (!tVal) return;

    props.onSubmit({
      title: tVal,
      issueType: issueType(),
      priority: priority(),
      description: description().trim() || undefined,
    });

    setTitle("");
    setDescription("");
    setIssueType("task");
    setPriority(2);
  };

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent class="max-w-md">
        <form onSubmit={handleSubmit} class="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t("beads.createTitle") as string}</DialogTitle>
          </DialogHeader>

          <div class="flex flex-col gap-3">
            {/* Title */}
            <div>
              <label class="text-xs font-semibold block mb-1">
                {t("beads.inputTitle") as string} *
              </label>
              <TextField>
                <TextFieldInput
                  placeholder={t("beads.inputTitlePlaceholder") as string}
                  class="h-8 text-xs"
                  value={title()}
                  onInput={(e) => setTitle(e.currentTarget.value)}
                  required
                  autofocus
                />
              </TextField>
            </div>

            {/* Type & Priority Row */}
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-xs font-semibold block mb-1">
                  {t("beads.filterType") as string}
                </label>
                <select
                  class="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                  value={issueType()}
                  onChange={(e) => setIssueType(e.currentTarget.value)}
                >
                  {BEADS_ISSUE_TYPES.map((type) => (
                    <option value={type}>{type}</option>
                  ))}
                </select>
              </div>

              <div>
                <label class="text-xs font-semibold block mb-1">
                  {t("beads.filterPriority") as string}
                </label>
                <select
                  class="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                  value={priority().toString()}
                  onChange={(e) => setPriority(parseInt(e.currentTarget.value, 10))}
                >
                  {Object.entries(PRIORITY_MAP).map(([p, meta]) => (
                    <option value={p}>{meta.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Description */}
            <div>
              <label class="text-xs font-semibold block mb-1">
                {t("beads.description") as string}
              </label>
              <TextField>
                <TextFieldTextArea
                  placeholder={t("beads.inputDescriptionPlaceholder") as string}
                  class="min-h-24 text-xs leading-relaxed"
                  value={description()}
                  onInput={(e) => setDescription(e.currentTarget.value)}
                />
              </TextField>
            </div>
          </div>

          <DialogFooter class="gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={props.onClose}
              disabled={props.isSubmitting}
            >
              {t("beads.cancel") as string}
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!title().trim() || props.isSubmitting}
            >
              {props.isSubmitting ? (t("beads.creating") as string) : (t("beads.createButton") as string)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
