import { createSignal, Show, For, type Component } from "solid-js";
import { createStore } from "solid-js/store";
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
import type { TaskDto, ConcurrentTask } from "~/types/dto";
import { toast } from "solid-sonner";
import { writeProjectTask } from "~/services/tauri/tasks";

type SubTaskRow = {
  label: string;
  command: string;
  dir: string;
};

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

  const isExistingConcurrent = () =>
    props.existingTask?.concurrent != null && props.existingTask.concurrent.length > 0;

  const initSubTasks = (): SubTaskRow[] => {
    if (props.existingTask?.concurrent) {
      return props.existingTask.concurrent.map((s) => ({
        label: s.label,
        command: s.argv.join(" "),
        dir: s.cwd ?? "",
      }));
    }
    return [];
  };

  const [name, setName] = createSignal(props.existingTask?.label ?? "");
  const [command, setCommand] = createSignal(
    props.existingTask?.concurrent
      ? ""
      : (props.existingTask?.source
          ?? props.existingTask?.argv.slice(2).join(" ")
          ?? ""),
  );
  const [description, setDescription] = createSignal(
    props.existingTask?.description ?? "",
  );
  const [kind, setKind] = createSignal(props.existingTask?.kind ?? "mise");
  const [depends, setDepends] = createSignal(
    props.existingTask?.depends.join(", ") ?? "",
  );
  const [concurrentMode, setConcurrentMode] = createSignal(isExistingConcurrent());
  const [subTasks, setSubTasks] = createStore<SubTaskRow[]>(
    initSubTasks().length > 0 ? initSubTasks() : [{ label: "", command: "", dir: "" }],
  );
  const [busy, setBusy] = createSignal(false);

  const reset = () => {
    setName("");
    setCommand("");
    setDescription("");
    setKind("mise");
    setDepends("");
    setConcurrentMode(false);
    setSubTasks([{ label: "", command: "", dir: "" }]);
  };

  const addSubTask = () => {
    setSubTasks((prev) => [...prev, { label: "", command: "", dir: "" }]);
  };

  const removeSubTask = (index: number) => {
    setSubTasks((prev) => prev.filter((_, i) => i !== index));
  };

  const updateSubTask = (index: number, field: keyof SubTaskRow, value: string) => {
    setSubTasks(index, field, value);
  };

  const handleSubmit = async () => {
    const n = name().trim();
    if (!n) {
      toast.error(t("projectDetail.taskEditor.nameRequired") as string);
      return;
    }

    if (concurrentMode()) {
      // Validate sub-tasks
      const validSubs = subTasks.filter((s) => s.label.trim() && s.command.trim());
      if (validSubs.length === 0) {
        toast.error(t("projectDetail.taskEditor.commandRequired") as string);
        return;
      }

      setBusy(true);
      try {
        const concurrent: ConcurrentTask[] = validSubs.map((s) => ({
          label: s.label.trim(),
          argv: s.command.trim().split(/\s+/),
          cwd: s.dir.trim() || undefined,
        }));

        const task: TaskDto = {
          id: isEdit() ? props.existingTask!.id : `${kind()}-${n}`,
          label: n,
          argv: [],
          kind: kind(),
          cwd: null,
          description: description().trim() || undefined,
          depends: depends()
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          source: JSON.stringify(concurrent),
          concurrent,
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
    } else {
      const cmd = command().trim();
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
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent class="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <span
              class={
                concurrentMode()
                  ? "iconify mdi--call-merge h-5 w-5 shrink-0 text-primary"
                  : kind() === "mise"
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
            <span class="text-sm font-medium">{t("projectDetail.taskEditor.name") as string}</span>
            <TextFieldInput
              placeholder={t("projectDetail.taskEditor.namePlaceholder") as string}
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              disabled={isEdit()}
            />
          </TextField>

          {/* Concurrent toggle — only for justfile */}
          <Show when={kind() === "justfile"}>
            <div class="flex items-center gap-2">
              <Button
                type="button"
                variant={concurrentMode() ? "default" : "outline"}
                size="sm"
                class="h-7 gap-1.5 text-xs"
                onClick={() => setConcurrentMode(!concurrentMode())}
              >
                <span class="iconify mdi--call-merge size-3.5" />
                {t("projectDetail.taskEditor.concurrent") as string}
              </Button>
              <Show when={concurrentMode()}>
                <span class="text-[11px] text-muted-foreground">
                  {t("projectDetail.taskEditor.concurrentHint") as string}
                </span>
              </Show>
            </div>
          </Show>

          <Show when={!concurrentMode()}>
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
          </Show>

          <Show when={concurrentMode()}>
            <div class="space-y-2">
              <span class="text-sm font-medium">{t("projectDetail.taskEditor.subTasks") as string}</span>
              <div class="space-y-2">
                <For each={subTasks}>
                  {(sub, index) => (
                    <div class="flex gap-2 items-start rounded-md border border-border/40 bg-muted/10 p-2">
                      <div class="flex-1 space-y-1.5">
                        <input
                          type="text"
                          placeholder={t("projectDetail.taskEditor.subTaskLabel") as string}
                          value={sub.label}
                          onInput={(e) => updateSubTask(index(), "label", e.currentTarget.value)}
                          class="flex h-7 w-full rounded-md border border-input bg-background px-2 py-1 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        />
                        <input
                          type="text"
                          placeholder={t("projectDetail.taskEditor.subTaskCommand") as string}
                          value={sub.command}
                          onInput={(e) => updateSubTask(index(), "command", e.currentTarget.value)}
                          class="flex h-7 w-full rounded-md border border-input bg-background px-2 py-1 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        />
                        <input
                          type="text"
                          placeholder={t("projectDetail.taskEditor.subTaskDir") as string}
                          value={sub.dir}
                          onInput={(e) => updateSubTask(index(), "dir", e.currentTarget.value)}
                          class="flex h-7 w-full rounded-md border border-input bg-background px-2 py-1 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        class="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => removeSubTask(index())}
                        disabled={subTasks.length <= 1}
                      >
                        <span class="iconify mdi--close size-3.5" />
                      </Button>
                    </div>
                  )}
                </For>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                class="h-7 gap-1.5 text-xs"
                onClick={addSubTask}
              >
                <span class="iconify mdi--plus size-3.5" />
                {t("projectDetail.taskEditor.addSubTask") as string}
              </Button>
            </div>
          </Show>

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
