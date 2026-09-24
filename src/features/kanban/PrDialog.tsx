import { Show, createSignal, type Component } from "solid-js";
import { createQuery } from "@tanstack/solid-query";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { TextField, TextFieldInput, TextFieldTextArea } from "~/components/ui/text-field";
import { useI18n } from "~/lib/i18n-context";
import { notify } from "~/lib/notification-store";
import type { CreatedPrDto } from "~/types/dto";
import { prCreate, prMerge, prStatus, workspaceGitInfo } from "~/services/tauri/workspaces";
import { KanbanSelect } from "./KanbanSelect";

type Props = Readonly<{
  workspaceId: string;
  onClose: () => void;
  onChanged: () => void;
}>;

export const PrDialog: Component<Props> = (props) => {
  const { t } = useI18n();
  const [base, setBase] = createSignal("");
  const [title, setTitle] = createSignal("");
  const [body, setBody] = createSignal("");
  const [created, setCreated] = createSignal<CreatedPrDto | null>(null);
  const [method, setMethod] = createSignal("merge");
  const [busy, setBusy] = createSignal(false);

  const gitInfoQ = createQuery(() => ({
    queryKey: ["workspace-git", props.workspaceId],
    queryFn: async () => {
      const r = await workspaceGitInfo(props.workspaceId);
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

  const create = async () => {
    const info = gitInfoQ.data;
    if (!info?.owner || !info?.repo) {
      notify({ title: t("workspace.noRemote") as string, severity: "error" });
      return;
    }
    setBusy(true);
    const r = await prCreate({
      workspaceId: props.workspaceId,
      base: base().trim() || undefined,
      title: title().trim() || undefined,
      body: body().trim() || undefined,
    });
    setBusy(false);
    if (r.isErr())
      notify({
        title: t("workspace.prFailed") as string,
        body: r.error.message,
        severity: "error",
      });
    else {
      setCreated(r.value);
      props.onChanged();
    }
  };

  const refreshStatus = async () => {
    const info = gitInfoQ.data;
    const pr = created();
    if (!info?.owner || !info?.repo || !pr) return;
    const r = await prStatus(info.owner, info.repo, pr.number);
    if (r.isErr())
      notify({
        title: t("workspace.prStatusFailed") as string,
        body: r.error.message,
        severity: "error",
      });
    else {
      setCreated({ number: r.value.number, htmlUrl: r.value.htmlUrl });
      if (r.value.merged) props.onChanged();
    }
  };

  const merge = async () => {
    const info = gitInfoQ.data;
    const pr = created();
    if (!info?.owner || !info?.repo || !pr) return;
    setBusy(true);
    const r = await prMerge({
      workspaceId: props.workspaceId,
      owner: info.owner,
      repo: info.repo,
      number: pr.number,
      method: method(),
    });
    setBusy(false);
    if (r.isErr())
      notify({
        title: t("workspace.mergeFailed") as string,
        body: r.error.message,
        severity: "error",
      });
    else if (r.value) {
      notify({ title: t("workspace.merged") as string, severity: "success" });
      props.onChanged();
      props.onClose();
    } else {
      notify({ title: t("workspace.notMerged") as string, severity: "error" });
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent class="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("workspace.newPr") as string}</DialogTitle>
        </DialogHeader>
        <div class="flex flex-col gap-2.5 py-2">
          <Show when={!gitInfoQ.data?.owner}>
            <p class="text-xs text-destructive">{t("workspace.noRemote") as string}</p>
          </Show>
          <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Badge variant="secondary">{gitInfoQ.data?.branch ?? "…"}</Badge>
            <span>→</span>
            <TextField class="w-32">
              <TextFieldInput
                class="h-7 text-xs"
                aria-label="base"
                placeholder={gitInfoQ.data?.base ?? "main"}
                value={base()}
                onInput={(e) => setBase(e.currentTarget.value)}
              />
            </TextField>
            <Show when={gitInfoQ.data && !gitInfoQ.data.pushed}>
              <Badge variant="outline">{t("workspace.notPushed") as string}</Badge>
            </Show>
          </div>
          <TextField>
            <TextFieldInput
              placeholder={t("workspace.prTitle") as string}
              class="h-8 text-sm"
              value={title()}
              onInput={(e) => setTitle(e.currentTarget.value)}
            />
          </TextField>
          <TextField>
            <TextFieldTextArea
              rows={6}
              class="text-sm"
              placeholder={t("workspace.prBodyHint") as string}
              value={body()}
              onInput={(e) => setBody(e.currentTarget.value)}
            />
          </TextField>
          <div class="flex gap-1.5">
            <Button size="sm" variant="default" disabled={busy()} onClick={() => void create()}>
              {t("workspace.createPr") as string}
            </Button>
          </div>
          <Show when={created()}>
            {(pr) => (
              <div class="flex flex-col gap-2 rounded-md border p-2.5">
                <a
                  href={pr().htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  class="text-sm text-primary hover:underline"
                >
                  PR #{pr().number}
                </a>
                <div class="flex items-center gap-1.5">
                  <KanbanSelect
                    ariaLabel="merge method"
                    value={method()}
                    options={["merge", "squash", "rebase"].map((m) => ({
                      value: m,
                      label: m,
                    }))}
                    onChange={setMethod}
                    class="w-28"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy()}
                    onClick={() => void refreshStatus()}
                  >
                    {t("workspace.refreshPr") as string}
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    disabled={busy()}
                    onClick={() => void merge()}
                  >
                    {t("workspace.mergePr") as string}
                  </Button>
                </div>
              </div>
            )}
          </Show>
        </div>
      </DialogContent>
    </Dialog>
  );
};
