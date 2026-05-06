import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { For, Show, createSignal, type Component } from "solid-js";
import { Button } from "~/components/ui/button";
import { TextField, TextFieldInput, TextFieldTextArea } from "~/components/ui/text-field";
import { listProjectTemplates, saveProjectTemplates } from "~/services/tauri/templates";
import type { TemplateSummaryDto } from "~/types/dto";

interface TemplatesSettingsTabProps {
  t: (key: string, args?: Record<string, unknown>) => string;
}

export const TemplatesSettingsTab: Component<TemplatesSettingsTabProps> = (props) => {
  const qc = useQueryClient();
  const templatesQ = createQuery(() => ({
    queryKey: ["project-templates"] as const,
    queryFn: async () => {
      const r = await listProjectTemplates();
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

  const [busy, setBusy] = createSignal(false);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [isAdding, setIsAdding] = createSignal(false);

  // Form state
  const [formName, setFormName] = createSignal("");
  const [formDesc, setFormDesc] = createSignal("");
  const [formType, setFormType] = createSignal<"command" | "git" | "files">("command");
  const [formCommand, setFormCommand] = createSignal("");
  const [formCwd, setFormCwd] = createSignal("project");
  const [formPostCreate, setFormPostCreate] = createSignal("");
  const [formGitSource, setFormGitSource] = createSignal("");
  const [formGitBranch, setFormGitBranch] = createSignal("main");
  const [formFiles, setFormFiles] = createSignal<Record<string, string>>({ "README.md": "# {name}" });
  const [formFileKey, setFormFileKey] = createSignal("");
  const [formFileValue, setFormFileValue] = createSignal("");

  const resetForm = () => {
    setFormName("");
    setFormDesc("");
    setFormType("command");
    setFormCommand("");
    setFormCwd("project");
    setFormPostCreate("");
    setFormGitSource("");
    setFormGitBranch("main");
    setFormFiles({ "README.md": "# {name}" });
    setFormFileKey("");
    setFormFileValue("");
    setEditingId(null);
    setIsAdding(false);
  };

  const startAdd = () => {
    resetForm();
    setIsAdding(true);
  };

  const startEdit = (tmpl: TemplateSummaryDto) => {
    setEditingId(tmpl.id);
    setFormName(tmpl.name);
    setFormDesc(tmpl.description);
    setFormType(tmpl.type as "command" | "git" | "files");
    const config = (tmpl.config ?? {}) as Record<string, unknown>;
    if (tmpl.type === "command") {
      setFormCommand((config.command as string) ?? "");
      setFormCwd((config.cwd as string) ?? "project");
      setFormPostCreate(
        (config.postCreate as string[])?.join("\n") ?? "",
      );
    } else if (tmpl.type === "git") {
      setFormGitSource((config.source as string) ?? "");
      setFormGitBranch((config.branch as string) ?? "main");
    } else if (tmpl.type === "files") {
      setFormFiles((config.files as Record<string, string>) ?? { "README.md": "# {name}" });
    }
    setIsAdding(true);
  };

  const handleSave = async () => {
    setBusy(true);
    try {
      const id = editingId() ?? `custom-${Date.now()}`;
      let config: Record<string, unknown> = {};
      if (formType() === "command") {
        config = {
          command: formCommand().trim(),
          cwd: formCwd(),
        };
        const post = formPostCreate()
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
        if (post.length > 0) config.postCreate = post;
      } else if (formType() === "git") {
        config = {
          source: formGitSource().trim(),
          branch: formGitBranch().trim() || "main",
        };
      } else if (formType() === "files") {
        config = { files: formFiles() };
      }

      const newTmpl: TemplateSummaryDto = {
        id,
        name: formName().trim(),
        description: formDesc().trim(),
        type: formType(),
        config,
      };

      const current = templatesQ.data ?? [];
      const next = editingId()
        ? current.map((t) => (t.id === editingId() ? newTmpl : t))
        : [...current, newTmpl];

      await saveProjectTemplates(JSON.stringify(next));
      void qc.invalidateQueries({ queryKey: ["project-templates"] });
      resetForm();
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(props.t("templates.deleteConfirm"))) return;
    setBusy(true);
    try {
      const next = (templatesQ.data ?? []).filter((t) => t.id !== id);
      await saveProjectTemplates(JSON.stringify(next));
      void qc.invalidateQueries({ queryKey: ["project-templates"] });
    } finally {
      setBusy(false);
    }
  };

  const addFileEntry = () => {
    const key = formFileKey().trim();
    const value = formFileValue();
    if (!key) return;
    setFormFiles((prev) => ({ ...prev, [key]: value }));
    setFormFileKey("");
    setFormFileValue("");
  };

  const removeFileEntry = (key: string) => {
    setFormFiles((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  return (
    <div class="space-y-6 animate-in fade-in duration-300">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-sm font-semibold">{props.t("templates.title")}</h3>
          <p class="text-xs text-muted-foreground mt-1">{props.t("templates.description")}</p>
        </div>
        <Button variant="default" size="sm" disabled={busy()} onClick={() => startAdd()}>
          <span class="iconify mdi--plus mr-1" />
          {props.t("templates.add")}
        </Button>
      </div>

      <Show when={isAdding()}>
        <div class="rounded-md border p-4 space-y-3">
          <h4 class="text-xs font-bold uppercase tracking-wider">
            {editingId() ? props.t("templates.edit") : props.t("templates.new")}
          </h4>
          <TextField>
            <TextFieldInput
              placeholder={props.t("templates.namePlaceholder")}
              value={formName()}
              onInput={(e) => setFormName(e.currentTarget.value)}
            />
          </TextField>
          <TextField>
            <TextFieldInput
              placeholder={props.t("templates.descPlaceholder")}
              value={formDesc()}
              onInput={(e) => setFormDesc(e.currentTarget.value)}
            />
          </TextField>
          <div class="flex gap-2">
            <For each={(["command", "git", "files"] as const)}>
              {(type) => (
                <button
                  type="button"
                  class={
                    formType() === type
                      ? "flex-1 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                      : "flex-1 rounded-md bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/80"
                  }
                  onClick={() => setFormType(type)}
                >
                  {props.t(`templates.type${type.charAt(0).toUpperCase() + type.slice(1)}`)}
                </button>
              )}
            </For>
          </div>

          <Show when={formType() === "command"}>
            <div class="space-y-2">
              <TextField>
                <TextFieldInput
                  placeholder={props.t("templates.commandPlaceholder")}
                  value={formCommand()}
                  onInput={(e) => setFormCommand(e.currentTarget.value)}
                />
              </TextField>
              <div class="flex gap-2">
                <button
                  type="button"
                  class={
                    formCwd() === "project"
                      ? "rounded-md bg-primary/10 px-3 py-1 text-xs font-semibold text-primary"
                      : "rounded-md bg-muted px-3 py-1 text-xs text-muted-foreground"
                  }
                  onClick={() => setFormCwd("project")}
                >
                  {props.t("templates.cwdProject")}
                </button>
                <button
                  type="button"
                  class={
                    formCwd() === "parent"
                      ? "rounded-md bg-primary/10 px-3 py-1 text-xs font-semibold text-primary"
                      : "rounded-md bg-muted px-3 py-1 text-xs text-muted-foreground"
                  }
                  onClick={() => setFormCwd("parent")}
                >
                  {props.t("templates.cwdParent")}
                </button>
              </div>
              <TextField>
                <TextFieldTextArea
                  placeholder={props.t("templates.postCreatePlaceholder")}
                  value={formPostCreate()}
                  onInput={(e) => setFormPostCreate(e.currentTarget.value)}
                  class="min-h-[60px] text-xs"
                />
              </TextField>
            </div>
          </Show>

          <Show when={formType() === "git"}>
            <div class="space-y-2">
              <TextField>
                <TextFieldInput
                  placeholder={props.t("templates.gitSourcePlaceholder")}
                  value={formGitSource()}
                  onInput={(e) => setFormGitSource(e.currentTarget.value)}
                />
              </TextField>
              <TextField>
                <TextFieldInput
                  placeholder={props.t("templates.gitBranchPlaceholder")}
                  value={formGitBranch()}
                  onInput={(e) => setFormGitBranch(e.currentTarget.value)}
                />
              </TextField>
            </div>
          </Show>

          <Show when={formType() === "files"}>
            <div class="space-y-2">
              <div class="flex gap-2">
                <TextField class="flex-1">
                  <TextFieldInput
                    placeholder={props.t("templates.fileKeyPlaceholder")}
                    value={formFileKey()}
                    onInput={(e) => setFormFileKey(e.currentTarget.value)}
                  />
                </TextField>
                <Button type="button" size="sm" variant="secondary" onClick={() => addFileEntry()}>
                  {props.t("templates.addFile")}
                </Button>
              </div>
              <Show when={Object.keys(formFiles()).length > 0}>
                <div class="space-y-1 max-h-40 overflow-y-auto">
                  <For each={Object.entries(formFiles())}>
                    {([key]) => (
                      <div class="flex items-center justify-between rounded bg-muted px-2 py-1">
                        <span class="text-xs font-mono truncate max-w-[200px]">{key}</span>
                        <button
                          type="button"
                          class="text-xs text-destructive hover:underline"
                          onClick={() => removeFileEntry(key)}
                        >
                          {props.t("common.remove")}
                        </button>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </Show>

          <div class="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => resetForm()}>
              {props.t("common.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy() || !formName().trim()}
              onClick={() => void handleSave()}
            >
              {props.t("common.save")}
            </Button>
          </div>
        </div>
      </Show>

      <Show when={templatesQ.isPending}>
        <div class="rounded-md border border-dashed p-6 text-center">
          <p class="text-sm text-muted-foreground">{props.t("common.loading")}</p>
        </div>
      </Show>

      <Show when={(templatesQ.data?.length ?? 0) === 0 && !isAdding() && !templatesQ.isPending}>
        <div class="rounded-md border border-dashed p-6 text-center">
          <p class="text-sm text-muted-foreground">{props.t("templates.empty")}</p>
        </div>
      </Show>

      <div class="space-y-2">
        <For each={templatesQ.data ?? []}>
          {(tmpl) => (
            <div class="flex items-center justify-between rounded-md border px-3 py-2">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium truncate">{tmpl.name}</span>
                  <span class="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                    {tmpl.type}
                  </span>
                </div>
                <p class="truncate text-xs text-muted-foreground">{tmpl.description}</p>
              </div>
              <div class="ml-2 flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  class="size-7"
                  disabled={busy()}
                  onClick={() => startEdit(tmpl)}
                >
                  <span class="iconify mdi--pencil text-sm" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  class="size-7 text-destructive"
                  disabled={busy()}
                  onClick={() => void handleDelete(tmpl.id)}
                >
                  <span class="iconify mdi--trash-can-outline text-sm" />
                </Button>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};
