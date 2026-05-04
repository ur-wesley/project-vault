import { For, Show, type Component } from "solid-js";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import type { ExtendedIssueRow } from "../model/useGithubIssues";
import { IssueMarkdown } from "./IssueMarkdown";
import { LabelBadge } from "./LabelBadge";

export type GithubIssueDetailProps = Readonly<{
  issue: ExtendedIssueRow;
  onBack: () => void;
  onEdit: () => void;
  onClose: () => void;
  isClosing: boolean;
  openExternal: (url: string) => void;
  localeCode: string;
  t: (key: string) => string;
}>;

export const GithubIssueDetail: Component<GithubIssueDetailProps> = (props) => {
  return (
    <div class="flex h-full flex-col min-h-0">
      <div class="mx-auto w-full max-w-3xl flex h-full flex-col min-h-0 animate-in fade-in slide-in-from-right-4 duration-300">
        <div class="mb-4 flex items-center justify-between border-b border-border/50 pb-3 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            class="h-8 gap-1.5 text-xs px-2"
            onClick={() => props.onBack()}
          >
            <span class="iconify mdi--arrow-left h-4 w-4" />
            {props.t('projectDetail.backToList')}
          </Button>
          <div class="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              class="h-8 gap-1.5 text-xs"
              onClick={() => props.onEdit()}
            >
              <span class="iconify mdi--pencil h-3.5 w-3.5" />
              {props.t('common.edit')}
            </Button>
            <Show when={props.issue.state === "open"}>
              <Button
                variant="outline"
                size="sm"
                class="h-8 gap-1.5 text-xs text-destructive hover:bg-destructive/10"
                disabled={props.isClosing}
                onClick={() => props.onClose()}
              >
                <Show when={props.isClosing}>
                  <span class="iconify mdi--loading animate-spin h-3.5 w-3.5" />
                </Show>
                <Show when={!props.isClosing}>
                  <span class="iconify mdi--close-circle-outline h-3.5 w-3.5" />
                </Show>
                {props.t('common.close')}
              </Button>
            </Show>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto pr-1 scrollbar-none">
          <div class="flex flex-wrap items-center gap-y-2 gap-x-4 mb-3 pb-4 border-b border-border/30">
            <Badge
              class="gap-1.5 h-6"
              variant={props.issue.state === "open" ? "default" : "secondary"}
            >
              <span
                class={cn(
                  "iconify h-3.5 w-3.5",
                  props.issue.state === "open"
                    ? "mdi--alert-circle-outline"
                    : "mdi--check-circle-outline",
                )}
              />
              {props.issue.state === 'open' ? props.t('projectDetail.issueStatusOpen') : props.t('projectDetail.issueStatusClosed')}
            </Badge>
            <Show when={props.issue.isLocal}>
               <Badge variant="outline" class="h-6 px-2 text-[10px] font-black uppercase tracking-wider border-primary/30 text-primary/70">
                 local
               </Badge>
            </Show>
            <div class="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
              <span class="iconify mdi--pound h-3.5 w-3.5 opacity-50" />
              {props.issue.number}
            </div>
            <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span class="iconify mdi--clock-outline h-3.5 w-3.5 opacity-50" />
              {new Date(props.issue.updatedAt).toLocaleDateString(props.localeCode)}
            </div>
            <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span class="iconify mdi--account-circle-outline h-3.5 w-3.5 opacity-50" />
              {props.issue.userLogin}
            </div>
          </div>

          <Show when={props.issue.labels.length > 0}>
             <div class="flex flex-wrap gap-1.5 mb-5">
                <For each={props.issue.labels}>
                   {(l) => <LabelBadge label={l} class="px-2.5 py-1 text-[10px]" />}
                </For>
             </div>
          </Show>

          <h2 class="text-xl font-bold tracking-tight mb-6">{props.issue.title}</h2>

          <div class="rounded-lg border border-border/40 bg-muted/20 p-4">
            <Show
              when={props.issue.body}
              fallback={
                <p class="italic text-muted-foreground text-xs">{props.t('projectDetail.noDescription')}</p>
              }
            >
              <IssueMarkdown content={props.issue.body} />
            </Show>
          </div>

          <div class="mt-8 flex justify-center pb-6">
             <Show when={props.issue.htmlUrl}>
               <Button
                 variant="link"
                 class="text-xs text-muted-foreground hover:text-primary gap-1.5"
                 onClick={() => props.openExternal(props.issue.htmlUrl)}
               >
                 <span class="iconify mdi--github h-3.5 w-3.5" />
                 {props.t('projectDetail.viewOnGithub')}
               </Button>
             </Show>
          </div>
        </div>
      </div>
    </div>
  );
};
