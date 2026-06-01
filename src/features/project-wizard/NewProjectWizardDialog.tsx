import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Show, createEffect, createMemo, createSignal } from "solid-js";
import { toast } from "solid-sonner";

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
import { TextField, TextFieldInput } from "~/components/ui/text-field";
import { useEventHub } from "~/lib/event-hub-context";
import { useI18n } from "~/lib/i18n-context";
import { stableErrorMessage } from "~/lib/invoke-error";
import { rescanAllLibraryFolders } from "~/lib/rescan-library";
import { listLocations } from "~/services/tauri/locations";
import { createProjectFromTemplate, listProjectTemplates, runTemplateCommand } from "~/services/tauri/templates";
import { getProjectTerminalStore } from "~/features/project-detail/model/global-terminal-store";
import { queryKeys } from "~/services/query-keys";
import type { TemplateSummaryDto } from "~/types/dto";

type LocationOption = { value: string; label: string; textValue: string };
type TemplateOption = { value: string; label: string; textValue: string };

export function NewProjectWizardDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenProjectTerminal?: (projectId: string) => void;
}) {
  const { t } = useI18n();
  const hub = useEventHub();
  const qc = useQueryClient();
  const [locationId, setLocationId] = createSignal("");
  const [projectName, setProjectName] = createSignal("");
  const [templateId, setTemplateId] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const locationsQ = createQuery(() => ({
    queryKey: queryKeys.locations,
    queryFn: async () => {
      const r = await listLocations();
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    enabled: props.open,
  }));

  const templatesQ = createQuery(() => ({
    queryKey: ["project-wizard", "templates"] as const,
    queryFn: async () => {
      const r = await listProjectTemplates();
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    enabled: props.open,
  }));

  const locationOptions = createMemo((): LocationOption[] => {
    const data = locationsQ.data;
    if (!data) return [];
    return data.map((l) => ({ value: l.id, label: l.name, textValue: `${l.name} ${l.path}` }));
  });

  const templateOptions = createMemo((): TemplateOption[] => {
    const data = templatesQ.data;
    if (!data) return [];
    return data.map((t) => ({ value: t.id, label: t.name, textValue: `${t.name} ${t.description}` }));
  });

  const selectedLocation = createMemo(() =>
    locationOptions().find((o) => o.value === locationId()),
  );

    const selectedTemplateOption = createMemo(
    () => templateOptions().find((o) => o.value === templateId()),
  );

  const selectedTemplate = createMemo((): TemplateSummaryDto | undefined => {
    const data = templatesQ.data;
    if (!data) return undefined;
    return data.find((t) => t.id === templateId());
  });

  const templatePreview = createMemo(() => {
    const tmpl = selectedTemplate();
    if (!tmpl) return null;
    const config = tmpl.config as Record<string, unknown>;
    const type = tmpl.type;
    if (type === "command") {
      const rawCmd = (config.command as string) ?? "";
      const cmd = rawCmd.replace(/\{name\}/g, projectName().trim() || "my-app");
      return { type: "command" as const, command: cmd, cwd: (config.cwd as string) ?? "project" };
    }
    if (type === "git") {
      return {
        type: "git" as const,
        source: (config.source as string) ?? "",
        branch: (config.branch as string) ?? "main",
      };
    }
    return {
      type: "files" as const,
      fileCount: (config.files as unknown[])?.length ?? 0,
    };
  });

  createEffect(() => {
    if (props.open && templatesQ.isSuccess && templatesQ.data && templatesQ.data.length > 0) {
      const cur = templateId();
      if (!cur) setTemplateId(templatesQ.data[0].id);
    }
  });

  createEffect(() => {
    if (!props.open) {
      toast.dismiss("wizard");
      setBusy(false);
    }
  });

  const onCreate = async () => {
    setBusy(true);
    toast.dismiss("wizard");
    const tid = templateId();
    const lid = locationId();
    if (!tid) {
      toast.error(t("wizard.pickTemplate") as string, { id: "wizard" });
      setBusy(false);
      return;
    }
    if (!lid) {
      toast.error(t("wizard.pickLocation") as string, { id: "wizard" });
      setBusy(false);
      return;
    }
    const name = projectName().trim();
    if (!name) {
      toast.error(t("wizard.enterName") as string, { id: "wizard" });
      setBusy(false);
      return;
    }

    const r = await createProjectFromTemplate({
      locationId: lid,
      projectName: name,
      templateId: tid,
    });
    if (r.isErr()) {
      toast.error(stableErrorMessage(t as any, r.error), { id: "wizard" });
      setBusy(false);
      return;
    }

    const result = r.value;
    const tmpl = selectedTemplate();
    const isCommand = tmpl?.type === "command";
    const tmplConfig = tmpl?.config as Record<string, unknown> | undefined;

    // For command templates, spawn embedded terminal and navigate to it
    if (isCommand && result.sessionId && result.projectId) {
      const cmd = result.sessionId;
      const projectId = result.projectId;
      const cwdMode = (tmplConfig?.cwd as string) ?? "project";
      const cwd = cwdMode === "project" ? result.projectPath : (locationsQ.data?.find((l) => l.id === lid)?.path ?? result.projectPath);

      const runR = await runTemplateCommand({ command: cmd, cwd });
      if (runR.isErr()) {
        toast.error(stableErrorMessage(t as any, runR.error), { id: "wizard" });
        setBusy(false);
        return;
      }

      const sessionId = runR.value.sessionId;

      // Attach the running session to the project's terminal store
      const store = getProjectTerminalStore(projectId);
      const instanceId = crypto.randomUUID();
      store.setInstances((current) => [
        {
          id: instanceId,
          name: tmpl?.name ?? "Setup",
          icon: "mdi--console",
          attachSessionId: sessionId,
        },
        ...current.filter((item) => item.id !== instanceId),
      ]);
      store.setActiveId(instanceId);

      toast.success(t("wizard.creatingInTerminal") as string, { id: "wizard", duration: 6000 });

      setBusy(false);
      props.onOpenChange(false);
      setProjectName("");
      setLocationId("");
      setTemplateId("");

      // Navigate to project terminal
      props.onOpenProjectTerminal?.(projectId);

      // Rescan in background after a delay so the command has time to create files
      void (async () => {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const n = await rescanAllLibraryFolders();
        hub.emit("scan:complete", { projectCount: n });
        void qc.invalidateQueries({ queryKey: queryKeys.projects });
        void qc.invalidateQueries({ queryKey: queryKeys.locations });
      })();
      return;
    }

    // Non-command templates: done immediately
    const n = await rescanAllLibraryFolders();
    hub.emit("scan:complete", { projectCount: n });
    void qc.invalidateQueries({ queryKey: queryKeys.projects });
    void qc.invalidateQueries({ queryKey: queryKeys.locations });
    setBusy(false);
    props.onOpenChange(false);
    setProjectName("");
    setLocationId("");
    setTemplateId("");
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent class="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("wizard.title") as string}</DialogTitle>
          <DialogDescription>{t("wizard.description") as string}</DialogDescription>
        </DialogHeader>
        <div class="flex flex-col gap-3">
          <label class="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("wizard.location") as string}
            <Select<LocationOption>
              options={locationOptions()}
              optionValue="value"
              optionTextValue="textValue"
              placeholder={t("wizard.loadingLocations") as string}
              value={selectedLocation()}
              onChange={(o) => o && setLocationId(String(o.value))}
              disabled={busy() || locationsQ.isPending || !locationsQ.isSuccess}
              itemComponent={(p) => (
                <Select.Item item={p.item}>
                  <Select.ItemIndicator>
                    <span class="iconify mdi--check h-4 w-4" aria-hidden="true" />
                  </Select.ItemIndicator>
                  <Select.ItemLabel>{p.item.rawValue.label}</Select.ItemLabel>
                </Select.Item>
              )}
            >
              <Select.Trigger>
                <Select.Value<LocationOption>>
                  {(s) => s.selectedOption()?.label ?? (t("wizard.loadingLocations") as string)}
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
            <Show
              when={templatesQ.isSuccess && (templatesQ.data?.length ?? 0) > 0}
              fallback={
                <span class="text-xs text-muted-foreground">
                  {templatesQ.isPending
                    ? (t("wizard.loadingTemplates") as string)
                    : (t("wizard.noTemplates") as string)}
                </span>
              }
            >
              <Select<TemplateOption>
                options={templateOptions()}
                optionValue="value"
                optionTextValue="textValue"
                placeholder={t("wizard.loadingTemplates") as string}
                value={selectedTemplateOption()}
                onChange={(o) => o && setTemplateId(String(o.value))}
                disabled={busy()}
                itemComponent={(p) => (
                  <Select.Item item={p.item}>
                    <Select.ItemIndicator>
                      <span class="iconify mdi--check h-4 w-4" aria-hidden="true" />
                    </Select.ItemIndicator>
                    <Select.ItemLabel>{p.item.rawValue.label}</Select.ItemLabel>
                  </Select.Item>
                )}
              >
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
            </Show>
          </label>
          <Show when={templatePreview()}>
            {(preview) => (
              <div class="rounded-md border bg-muted/30 p-3 space-y-1.5">
                <div class="flex items-center gap-2">
                  <span class="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                    {preview().type}
                  </span>
                  <Show when={selectedTemplate()}>
                    {(tmpl) => (
                      <span class="text-xs text-muted-foreground">{tmpl().description}</span>
                    )}
                  </Show>
                </div>
                <Show when={preview().type === "command"}>
                  <code class="block rounded bg-muted px-2 py-1.5 font-mono text-[11px] text-foreground">
                    {preview().command}
                  </code>
                  <Show when={preview().cwd === "parent"}>
                    <span class="text-[10px] text-muted-foreground">
                      {t("wizard.cwdParent") as string}
                    </span>
                  </Show>
                </Show>
                <Show when={preview().type === "git"}>
                  <div class="text-xs space-y-0.5">
                    <p><span class="text-muted-foreground">{t("wizard.source") as string}:</span> {preview().source}</p>
                    <p><span class="text-muted-foreground">{t("wizard.branch") as string}:</span> {preview().branch}</p>
                  </div>
                </Show>
                <Show when={preview().type === "files"}>
                  <span class="text-xs text-muted-foreground">
                    {t("wizard.filesCount", { count: preview().fileCount ?? 0 }) as string}
                  </span>
                </Show>
              </div>
            )}
          </Show>
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
            disabled={busy() || !locationId() || !projectName().trim() || !templateId()}
            onClick={() => void onCreate()}
          >
            {busy() && <span class="iconify mdi--loading animate-spin mr-1.5 size-4" />}
            {t("wizard.create") as string}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
