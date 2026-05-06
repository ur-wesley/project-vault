import { createSignal, Show, type Component } from "solid-js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import {
  TextField,
  TextFieldInput,
  TextFieldTextArea,
} from "~/components/ui/text-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { useI18n } from "~/lib/i18n-context";
import type { TaskDto } from "~/types/dto";
import { toast } from "solid-sonner";
import { writeProjectTask } from "~/services/tauri/tasks";

export type TaskEditorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectPath: string;
  existingTask?: TaskDto | null;
  availableKinds: string[];
  onSaved: () => void;
};

export const TaskEditorDialog: Component<TaskEditorDialogProps> = (props) => {
  const { t } = useI18n();
  const isEdit = () => props.existingTask != null;

  const [name, setName] = createSignal(props.existingTask?.label ?? "");
  const [command, setCommand] = createSignal(
    props.existingTask?.source
      ?? props.existingTask?.argv.slice(2).join(" ")
      ?? "",
  );
  const [description, setDescription] = createSignal(
    props.existingTask?.description ?? "",
  );
  const [kind, setKind] = createSignal(props.existingTask?.kind ?? "mise");
  const [depends, setDepends] = createSignal(
    props.existingTask?.depends.join(", ") ?? "",
  );
  const [busy, setBusy] = createSignal(false);

  const reset = () => {
    setName("");
    setCommand("");
    setDescription("");
    setKind("mise");
    setDepends("");
  };

  const handleSubmit = async () => {
    const n = name().trim();
    const cmd = command().trim();
    if (!n) {
      toast.error(t("projectDetail.taskEditor.nameRequired") as string);
      return;
    }
    if (!cmd) {
      toast.error(t("projectDetail.taskEditor.commandRequired") as string);
      return;
    }

    setBusy(true);
    try {
      const task: TaskDto = {
        id: isEdit() ? props.existingTask!.id : `${kind()}-${n}`,
        label: n,
        argv:
          kind() === "mise"
            ? ["mise", "run", ...cmd.split(/\s+/)]
            : ["just", n],
        kind: kind(),
        cwd: null,
        description: description().trim() || undefined,
        depends: depends()
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        source: cmd || undefined,
      };

      const r = await writeProjectTask(props.projectId, task);
      if (r.isErr()) {
        toast.error(r.error.message);
        return;
      }

      toast.success(
        isEdit()
          ? (t("projectDetail.taskEditor.updated") as string)
          : (t("projectDetail.taskEditor.created") as string),
      );
      props.onSaved();
      props.onOpenChange(false);
      if (!isEdit()) reset();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <span
              class={
                kind() === "mise"
                  ? "iconify mdi--wrench-outline h-5 w-5 shrink-0 text-primary"
                  : "iconify mdi--file-document-edit-outline h-5 w-5 shrink-0 text-primary"
              }
            />
            {isEdit()
              ? (t("projectDetail.taskEditor.editTitle") as string)
              : (t("projectDetail.taskEditor.createTitle") as string)}
          </DialogTitle>
        </DialogHeader>

        <div class="space-y-4 py-2">
          <TextField class="space-y-2">
            <span class="text-sm font-medium">{t("projectDetail.taskEditor.kind") as string}</span>
            <Select
              value={kind()}
              onChange={(v) => v && setKind(v)}
              options={props.availableKinds}
              itemComponent={(p) => (
                <SelectItem item={p.item}>
                  {p.item.rawValue === "mise" ? "Mise" : "Justfile"}
                </SelectItem>
              )}
            >
              <SelectTrigger>
                <SelectValue>
                  {kind() === "mise" ? "Mise" : "Justfile"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <Select.Listbox />
              </SelectContent>
            </Select>
          </TextField>

          <TextField class="space-y-2">
            <span class="text-sm font-medium">{t("projectDetail.projectDetail.taskEditor.name") as string}</span>
            <TextFieldInput
              placeholder={t("projectDetail.taskEditor.namePlaceholder") as string}
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              disabled={isEdit()}
            />
          </TextField>

          <TextField class="space-y-2">
            <span class="text-sm font-medium">{t("projectDetail.taskEditor.command") as string}</span>
            <TextFieldTextArea
              placeholder={t("projectDetail.taskEditor.commandPlaceholder") as string}
              value={command()}
              onInput={(e) => setCommand(e.currentTarget.value)}
              rows={3}
            />
            <p class="text-[11px] text-muted-foreground">
              {t("projectDetail.taskEditor.commandHint") as string}
            </p>
          </TextField>

          <TextField class="space-y-2">
            <span class="text-sm font-medium">{t("projectDetail.taskEditor.description") as string}</span>
            <TextFieldInput
              placeholder={t("projectDetail.taskEditor.descriptionPlaceholder") as string}
              value={description()}
              onInput={(e) => setDescription(e.currentTarget.value)}
            />
          </TextField>

          <Show when={kind() === "mise"}>
            <TextField class="space-y-2">
              <span class="text-sm font-medium">{t("projectDetail.taskEditor.depends") as string}</span>
              <TextFieldInput
                placeholder={t("projectDetail.taskEditor.dependsPlaceholder") as string}
                value={depends()}
                onInput={(e) => setDepends(e.currentTarget.value)}
              />
              <p class="text-[11px] text-muted-foreground">
                {t("projectDetail.taskEditor.dependsHint") as string}
              </p>
            </TextField>
          </Show>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => props.onOpenChange(false)}
          >
            {t("common.cancel") as string}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={busy()}>
            <Show when={busy()}>
              <span class="iconify mdi--loading animate-spin mr-2 size-4" />
            </Show>
            {isEdit()
              ? (t("projectDetail.taskEditor.save") as string)
              : (t("projectDetail.taskEditor.create") as string)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
