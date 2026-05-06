import { For, Show } from "solid-js";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { TextField, TextFieldInput } from "~/components/ui/text-field";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { LabelBadge } from "./LabelBadge";
import type { ExtendedIssueRow } from "../model/useGithubIssues";

type IssueFilterState = "all" | "open" | "closed";
type FilterOption = { value: IssueFilterState; label: string };

export function GithubIssueList(props: {
  filteredIssues: () => ExtendedIssueRow[];
  issuesQ: { isPending: boolean; isError: boolean; isSuccess: boolean; error: unknown };
  issuesErrorMessage: string | null;
  search: string;
  onSearchChange: (v: string) => void;
  filter: IssueFilterState;
  onFilterChange: (v: IssueFilterState) => void;
  filterOptions: FilterOption[];
  onNewIssue: () => void;
  onSelectIssue: (id: string) => void;
  github: { owner: string; repo: string } | null;
  localIssuesCount: number;
  syncDismissed: boolean;
  onSync: () => void;
  syncPending: boolean;
  localeCode: string;
  t: (k: string, args?: Record<string, unknown>) => string;
}) {
  return (
    <div class="flex h-full flex-col min-h-0">
      <div class="mx-auto w-full max-w-3xl flex flex-col h-full min-h-0">
        <div class="mb-4 flex flex-col gap-3 border-b border-border/50 pb-4 shrink-0">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <span class="text-sm font-semibold">
                {props.t("projectDetail.githubIssues")}
              </span>
              <Badge variant="secondary" class="h-5 px-1.5 text-[10px] tabular-nums font-mono">
                {props.filteredIssues().length}
              </Badge>

              <Show when={props.github != null && props.localIssuesCount > 0 && props.syncDismissed}>
                <Tooltip>
                  <TooltipTrigger
                    as={Button}
                    size="icon"
                    variant="ghost"
                    class="h-6 w-6 text-primary/60 hover:text-primary hover:bg-primary/10"
                    onClick={() => props.onSync()}
                    disabled={props.syncPending}
                  >
                    <Show when={props.syncPending} fallback={<span class="iconify mdi--cloud-upload h-3.5 w-3.5" />}>
                      <span class="iconify mdi--loading animate-spin h-3.5 w-3.5" />
                    </Show>
                  </TooltipTrigger>
                  <TooltipContent class="text-xs">
                    {props.t("projectDetail.syncLocalIssuesTooltip", { count: props.localIssuesCount })}
                  </TooltipContent>
                </Tooltip>
              </Show>
            </div>
            <Button
              size="sm"
              class="h-8 gap-1.5 px-3"
              onClick={() => props.onNewIssue()}
            >
              <span class="iconify mdi--plus h-4 w-4" />
              {props.t("projectDetail.newIssue")}
            </Button>
          </div>

          <div class="flex gap-2">
            <TextField class="flex-1">
              <TextFieldInput
                placeholder={props.t("projectDetail.searchIssues")}
                class="h-8 text-xs"
                value={props.search}
                onInput={(e) => props.onSearchChange(e.currentTarget.value)}
                autocomplete="off"
              />
            </TextField>
            <div class="w-32">
              <Select<FilterOption>
                options={props.filterOptions}
                optionValue="value"
                optionTextValue="label"
                value={props.filterOptions.find((o) => o.value === props.filter)}
                onChange={(o) => o && props.onFilterChange(o.value)}
                itemComponent={(p) => (
                  <SelectItem item={p.item}>
                    {p.item.rawValue.label}
                  </SelectItem>
                )}
              >
                <SelectTrigger class="h-8 bg-muted/30 text-xs">
                  <SelectValue<FilterOption>>
                    {(s) => s.selectedOption()?.label ?? props.t("common.status")}
                  </SelectValue>
                  <span class="iconify mdi--chevron-down h-4 w-4 opacity-50" />
                </SelectTrigger>
                <SelectContent />
              </Select>
            </div>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto pr-1 pb-3 scrollbar-none">
          <Show when={props.issuesQ.isPending}>
            <p class="text-sm text-muted-foreground">{props.t("github.loadingIssues")}</p>
          </Show>
          <Show when={props.issuesQ.isError}>
            <p class="text-sm text-destructive" role="alert">
              {props.issuesErrorMessage}
            </p>
          </Show>
          <Show
            when={props.issuesQ.isSuccess && props.filteredIssues().length > 0}
            fallback={
              <Show when={props.issuesQ.isSuccess}>
                <div class="flex flex-col items-center justify-center py-12 text-center">
                  <span class="iconify mdi--alert-circle-outline mb-2 h-8 w-8 text-muted-foreground/40" />
                  <p class="text-sm text-muted-foreground">
                    {props.t("projectDetail.noIssuesFound")}
                  </p>
                </div>
              </Show>
            }
          >
            <ul class="space-y-2">
              <For each={props.filteredIssues()}>
                {(row) => (
                  <li
                    class={cn(
                      "group flex flex-col gap-1.5 rounded-md border border-border/40 bg-card/40 px-3 py-2.5 transition-colors",
                      row.isPending
                        ? "opacity-60 cursor-default grayscale-[50%]"
                        : "cursor-pointer hover:bg-muted/30",
                    )}
                    onClick={() =>
                      !row.isPending && props.onSelectIssue(`${row.number}:${row.isLocal ? "local" : "github"}`)
                    }
                  >
                    <div class="flex items-start gap-2">
                      <span
                        class={cn(
                          "iconify h-4 w-4 shrink-0 mt-0.5",
                          row.isPending
                            ? "mdi--loading animate-spin text-muted-foreground"
                            : row.state === "open"
                              ? "mdi--alert-circle-outline text-green-500"
                              : "mdi--check-circle-outline text-purple-500",
                        )}
                      />
                      <div class="min-w-0 flex-1 space-y-1">
                        <div class="flex items-center gap-2 justify-between">
                          <div class="flex items-center gap-2 min-w-0 flex-1">
                            <span class="min-w-0 truncate text-sm font-medium">
                              {row.title}
                            </span>
                            <Show when={row.isLocal}>
                              <Badge variant="outline" class="h-4 px-1 text-[8px] font-bold uppercase tracking-tighter border-primary/30 text-primary/70">
                                local
                              </Badge>
                            </Show>
                          </div>
                          <Show
                            when={!row.isPending}
                            fallback={
                              <span class="text-[9px] font-bold uppercase tracking-widest text-primary animate-pulse">
                                Sending...
                              </span>
                            }
                          >
                            <span class="text-[10px] text-muted-foreground font-mono tabular-nums opacity-60">
                              #{row.number}
                            </span>
                          </Show>
                        </div>
                        <Show when={row.labels.length > 0}>
                          <div class="flex flex-wrap gap-1">
                            <For each={row.labels}>
                              {(l) => <LabelBadge label={l} />}
                            </For>
                          </div>
                        </Show>
                      </div>
                    </div>
                    <div class="flex items-center gap-2 pl-6 text-[10px] text-muted-foreground">
                      <span>
                        {(() => {
                          const date = new Date(row.updatedAt);
                          return isNaN(date.getTime()) ? "recently" : date.toLocaleDateString(props.localeCode);
                        })()}
                      </span>
                      <span>•</span>
                      <span>{row.userLogin || "local"}</span>
                    </div>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>
      </div>
    </div>
  );
}
