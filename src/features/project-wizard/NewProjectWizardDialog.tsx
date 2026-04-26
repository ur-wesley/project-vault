import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Show, createEffect, createMemo, createSignal } from "solid-js";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Select } from "~/components/ui/select";
import { TextField, TextFieldInput } from "~/components/ui/text-field";
import { useEventHub } from "~/lib/event-hub-context";
import { useI18n } from "~/lib/i18n-context";
import { stableErrorMessage } from "~/lib/invoke-error";
import { rescanAllLibraryFolders } from "~/lib/rescan-library";
import {
  createProjectFromTemplate,
  listProjectTemplates,
  pickProjectParentFolder,
} from "~/services/tauri";
import { queryKeys } from "~/services/query-keys";

type TemplateOption = { value: string; label: string; textValue: string };

export function NewProjectWizardDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const hub = useEventHub();
  const qc = useQueryClient();
  const [parentPath, setParentPath] = createSignal("");
  const [projectName, setProjectName] = createSignal("");
  const [templateId, setTemplateId] = createSignal("");
  const [runPost, setRunPost] = createSignal(true);
  const [busy, setBusy] = createSignal(false);
  const [banner, setBanner] = createSignal<string | null>(null);

  const templatesQ = createQuery(() => ({
    queryKey: ["project-templates"] as const,
    queryFn: async () => {
      const r = await listProjectTemplates();
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    enabled: props.open,
  }));

  const templateOptions = createMemo((): TemplateOption[] =>
    (templatesQ.data ?? []).map((x) => ({
      value: x.id,
      label: x.name,
      textValue: x.name,
    })),
  );

  const selectedTemplate = createMemo(
    () => templateOptions().find((o) => o.value === templateId()) ?? null,
  );

  createEffect(() => {
    if (props.open && templatesQ.isSuccess && templatesQ.data && templatesQ.data.length > 0) {
      const cur = templateId();
      if (!cur) setTemplateId(templatesQ.data[0].id);
    }
  });

  createEffect(() => {
    if (!props.open) {
      setBanner(null);
      setBusy(false);
    }
  });

  const onPickParent = async () => {
    setBanner(null);
    const r = await pickProjectParentFolder();
    if (r.isErr()) {
      setBanner(stableErrorMessage(t, r.error));
      return;
    }
    if (r.value) setParentPath(r.value);
  };

  const onCreate = async () => {
    setBusy(true);
    setBanner(null);
    const tid = templateId();
    if (!tid) {
      setBanner(t("wizard.pickTemplate") as string);
      setBusy(false);
      return;
    }
    const r = await createProjectFromTemplate({
      parentPath: parentPath(),
      projectName: projectName(),
      templateId: tid,
      runPostCreate: runPost(),
    });
    if (r.isErr()) {
      setBanner(stableErrorMessage(t, r.error));
      setBusy(false);
      return;
    }
    const n = await rescanAllLibraryFolders();
    hub.emit("scan:complete", { projectCount: n });
    void qc.invalidateQueries({ queryKey: queryKeys.projects });
    void qc.invalidateQueries({ queryKey: queryKeys.locations });
    setBusy(false);
    props.onOpenChange(false);
    setProjectName("");
    setParentPath("");
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("wizard.title") as string}</DialogTitle>
          <DialogDescription>{t("wizard.description") as string}</DialogDescription>
        </DialogHeader>
        <Show when={banner() != null && (banner() as string).length > 0}>
          <p class="text-sm text-muted-foreground">{banner()}</p>
        </Show>
        <div class="flex flex-col gap-3">
          <div class="flex flex-col gap-1">
            <span class="text-xs text-muted-foreground">{t("wizard.parentFolder") as string}</span>
            <div class="flex gap-2">
              <TextField class="min-w-0 flex-1">
                <TextFieldInput
                  readOnly
                  value={parentPath()}
                  placeholder={t("wizard.parentPlaceholder") as string}
                  class="font-mono text-xs"
                />
              </TextField>
              <Button
                type="button"
                variant="secondary"
                disabled={busy()}
                onClick={() => void onPickParent()}
              >
                {t("wizard.browse") as string}
              </Button>
            </div>
          </div>
          <TextField>
            <TextFieldInput
              placeholder={t("wizard.projectName") as string}
              value={projectName()}
              onInput={(e) => setProjectName(e.currentTarget.value)}
              disabled={busy()}
            />
          </TextField>
          <label class="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("wizard.template") as string}
            <Select<TemplateOption>
              options={templateOptions()}
              optionValue="value"
              optionTextValue="textValue"
              placeholder={t("wizard.loadingTemplates") as string}
              value={selectedTemplate()}
              onChange={(o) => o && setTemplateId(String(o.value))}
              disabled={busy() || templatesQ.isPending || !templatesQ.isSuccess}
              itemComponent={(p) => (
                <Select.Item item={p.item}>
                  <Select.ItemIndicator>
                    <span class="iconify mdi--check h-4 w-4" aria-hidden="true" />
                  </Select.ItemIndicator>
                  <Select.ItemLabel>{p.item.rawValue.label}</Select.ItemLabel>
                </Select.Item>
              )}
            >
              <Select.HiddenSelect />
              <Select.Trigger>
                <Select.Value<TemplateOption>>
                  {(s) => s.selectedOption()?.label ?? (t("wizard.loadingTemplates") as string)}
                </Select.Value>
                <Select.Icon>
                  <span class="iconify mdi--chevron-down h-4 w-4 opacity-50" aria-hidden="true" />
                </Select.Icon>
              </Select.Trigger>
              <Select.Content>
                <Select.Listbox />
              </Select.Content>
            </Select>
          </label>
          <label class="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={runPost()} onChange={(v) => setRunPost(!!v)} disabled={busy()} />
            {t("wizard.runPostCreate") as string}
          </label>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            disabled={busy()}
            onClick={() => props.onOpenChange(false)}
          >
            {t("wizard.cancel") as string}
          </Button>
          <Button
            type="button"
            disabled={busy() || !parentPath() || !projectName().trim()}
            onClick={() => void onCreate()}
          >
            {t("wizard.create") as string}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
