import { For, Show, createSignal, type Component } from "solid-js";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { TextField, TextFieldInput } from "~/components/ui/text-field";
import { cn } from "~/lib/utils";
import type { GitHubIssueRow } from "~/services/github";

export type GithubIssueDialogsProps = Readonly<{
  createOpen: boolean;
  setCreateOpen: (v: boolean) => void;
  editIssue: GitHubIssueRow | null;
  setEditIssue: (v: GitHubIssueRow | null) => void;
  title: string;
  setTitle: (v: string) => void;
  body: string;
  setBody: (v: string) => void;
  selectedLabels: string[];
  toggleLabel: (name: string) => void;
  labels: { name: string; color: string }[];
  github: { owner: string; repo: string } | null;
  createM: { isPending: boolean; mutate: (args: any) => void };
  updateM: { isPending: boolean; mutate: (args: any) => void };
  t: (key: string, args?: any) => string;
}>;

function LabelBadge(props: { label: { name: string; color: string }, class?: string }) {
  const isDark = (color: string) => {
    const r = parseInt(color.slice(0, 2), 16);
    const g = parseInt(color.slice(2, 4), 16);
    const b = parseInt(color.slice(4, 6), 16);
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luma < 128;
  };

  return (
    <span
      class={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-tight shadow-sm", props.class)}
      style={{
        "background-color": `#${props.label.color}`,
        color: isDark(props.label.color) ? "white" : "black",
      }}
    >
      {props.label.name}
    </span>
  );
}

export const GithubIssueDialogs: Component<GithubIssueDialogsProps> = (props) => {
  return (
    <>
      {/* New Issue Dialog */}
      <Dialog open={props.createOpen} onOpenChange={props.setCreateOpen}>
        <DialogContent class="max-w-xl">
          <DialogHeader>
            <DialogTitle>{props.t('projectDetail.createNewIssue')}</DialogTitle>
            <DialogDescription>
              {props.t('projectDetail.submitIssueTo', { owner: props.github?.owner ?? '', repo: props.github?.repo ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <div class="flex flex-col gap-4 py-4">
            <TextField class="grid gap-2">
              <TextFieldInput
                placeholder={props.t('projectDetail.issueTitle')}
                value={props.title}
                onInput={(e) => props.setTitle(e.currentTarget.value)}
              />
            </TextField>
            <textarea
              class="flex min-h-[160px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder={props.t('projectDetail.issueDescription')}
              value={props.body}
              onInput={(e) => props.setBody(e.currentTarget.value)}
            />
            
            <div class="space-y-2">
               <label class="text-xs font-bold uppercase tracking-wider text-muted-foreground/60">{props.t('projectDetail.labels')}</label>
               <div class="flex flex-wrap gap-1.5">
                  <For each={props.labels}>
                     {(l) => (
                        <button
                          type="button"
                          onClick={() => props.toggleLabel(l.name)}
                          class={cn(
                            "transition-opacity hover:opacity-100",
                            props.selectedLabels.includes(l.name) ? "opacity-100" : "opacity-30 grayscale-[50%]"
                          )}
                        >
                           <LabelBadge label={l} class="cursor-pointer py-1 px-2.5" />
                        </button>
                     )}
                  </For>
               </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => props.setCreateOpen(false)}>
              {props.t('common.cancel')}
            </Button>
            <Button
              disabled={props.createM.isPending || !props.title.trim()}
              onClick={() => props.createM.mutate({ title: props.title, body: props.body, labels: props.selectedLabels })}
            >
              <Show when={props.createM.isPending}>
                <span class="iconify mdi--loading mr-2 h-4 w-4 animate-spin" />
              </Show>
              {props.t('projectDetail.newIssue')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Issue Dialog */}
      <Dialog open={!!props.editIssue} onOpenChange={(o) => !o && props.setEditIssue(null)}>
        <DialogContent class="max-w-xl">
          <DialogHeader>
            <DialogTitle>{props.t('projectDetail.editIssue', { number: props.editIssue?.number ?? 0 })}</DialogTitle>
          </DialogHeader>
          <div class="flex flex-col gap-4 py-4">
            <TextField class="grid gap-2">
              <TextFieldInput
                placeholder={props.t('projectDetail.issueTitle')}
                value={props.title}
                onInput={(e) => props.setTitle(e.currentTarget.value)}
              />
            </TextField>
            <textarea
              class="flex min-h-[160px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder={props.t('projectDetail.issueDescription')}
              value={props.body}
              onInput={(e) => props.setBody(e.currentTarget.value)}
            />

            <div class="space-y-2">
               <label class="text-xs font-bold uppercase tracking-wider text-muted-foreground/60">{props.t('projectDetail.labels')}</label>
               <div class="flex flex-wrap gap-1.5">
                  <For each={props.labels}>
                     {(l) => (
                        <button
                          type="button"
                          onClick={() => props.toggleLabel(l.name)}
                          class={cn(
                            "transition-opacity hover:opacity-100",
                            props.selectedLabels.includes(l.name) ? "opacity-100" : "opacity-30 grayscale-[50%]"
                          )}
                        >
                           <LabelBadge label={l} class="cursor-pointer py-1 px-2.5" />
                        </button>
                     )}
                  </For>
               </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => props.setEditIssue(null)}>
              {props.t('common.cancel')}
            </Button>
            <Button
              disabled={props.updateM.isPending || !props.title.trim()}
              onClick={() =>
                props.updateM.mutate({ 
                    number: props.editIssue!.number, 
                    title: props.title, 
                    body: props.body,
                    labels: props.selectedLabels 
                })
              }
            >
              <Show when={props.updateM.isPending}>
                <span class="iconify mdi--loading mr-2 h-4 w-4 animate-spin" />
              </Show>
              {props.t('projectDetail.saveChanges')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
