import { For, Show } from "solid-js";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Select, SelectTrigger } from "~/components/ui/select";
import { useI18n } from "~/lib/i18n-context";
import { cn } from "~/lib/utils";
import type { ProjectDetailModel } from "../model/createProjectDetailModel";
import { formatSessionRange } from "../lib/format";

type SessionState = "running" | "starting" | "success" | "error" | "cancelled" | "unknown";
type StatusOption = { value: SessionState | "all"; label: string };

const PAGE_SIZE = 20;
const statusOptions: StatusOption[] = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "starting", label: "Starting" },
  { value: "success", label: "Success" },
  { value: "error", label: "Error" },
  { value: "cancelled", label: "Cancelled" },
];

function statusVariant(state: string): "default" | "secondary" | "outline" | "destructive" | "success" {
  switch (state) {
    case "running":
    case "starting":
      return "default";
    case "success":
      return "success";
    case "error":
    case "cancelled":
      return "destructive";
    default:
      return "secondary";
  }
}

export function HistoryTabPanel(props: {
  model: ProjectDetailModel;
}) {
  const { t } = useI18n();
  const m = () => props.model;

  return (
    <div class="flex h-full flex-col overflow-hidden">
      <div class="mb-3 flex flex-wrap items-center gap-2 relative z-10">
        <Select
          options={statusOptions}
          optionValue="value"
          optionTextValue="label"
          value={statusOptions.find((o) => o.value === m().statusFilter())}
          onChange={(o) => o && m().setStatusFilter(o.value as SessionState | "all")}
          itemComponent={(p) => (
            <Select.Item item={p.item}>
              <Select.ItemLabel class="text-xs">
                {p.item.rawValue.label}
              </Select.ItemLabel>
            </Select.Item>
          )}
        >
          <SelectTrigger class="h-8 w-36 bg-muted/30 text-xs">
            <Select.Value<StatusOption>>
              {(s) => s.selectedOption()?.label ?? t("history.filterPlaceholder")}
            </Select.Value>
            <span class="iconify mdi--chevron-down h-4 w-4 opacity-50" />
          </SelectTrigger>
          <Select.Content>
            <Select.Listbox />
          </Select.Content>
        </Select>
        <span class="text-xs text-muted-foreground">
          {m().sessionsQ.data?.length ?? 0}
          {m().statusFilter() === "all"
            ? m().totalCount() > 0 && ` / ${m().totalCount()}`
            : m().filteredCount() > 0 && ` / ${m().filteredCount()}`}
          {t("history.entries") as string}
        </span>

        <Show when={(m().statusFilter() === "all" ? m().totalCount() : m().filteredCount()) > PAGE_SIZE}>
          <div class="flex items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              class="size-7"
              disabled={m().page() === 0}
              onClick={() => m().setPage((p) => Math.max(0, p - 1))}
            >
              <span class="iconify mdi--chevron-left size-4" />
            </Button>
            <span class="text-[11px] text-muted-foreground tabular-nums px-1">
              {m().page() + 1}
              /
              {Math.ceil(((m().statusFilter() === "all" ? m().totalCount() : m().filteredCount()) ?? 0) / PAGE_SIZE)}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              class="size-7"
              disabled={(m().page() + 1) * PAGE_SIZE >= ((m().statusFilter() === "all" ? m().totalCount() : m().filteredCount()) ?? 0)}
              onClick={() => m().setPage((p) => p + 1)}
            >
              <span class="iconify mdi--chevron-right size-4" />
            </Button>
          </div>
        </Show>

        <div class="ml-auto">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                class="h-8 text-xs text-muted-foreground hover:text-destructive"
                disabled={m().clearSessionsMu.isPending}
              >
                <span class="iconify mdi--delete-outline mr-1.5 size-4" />
                {t("history.clear") as string}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("history.clearConfirmTitle") as string}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("history.clearConfirmDesc") as string}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("common.cancel") as string}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => m().clearSessionsMu.mutate()}
                  class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {t("history.clear") as string}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      <div class="flex-1 overflow-y-auto pr-1 pb-3">
        <Show when={m().sessionsQ.isPending}>
          <p class="text-sm text-muted-foreground">{t("library.loading") as string}</p>
        </Show>
        <Show when={m().sessionsQ.isError}>
          <p class="text-sm text-destructive">{t("library.error") as string}</p>
        </Show>
        <Show when={!m().sessionsQ.isPending && !m().sessionsQ.isError && (m().sessionsQ.data?.length ?? 0) === 0}>
          <p class="text-sm text-muted-foreground">{t("history.empty") as string}</p>
        </Show>
        <ul class="space-y-2 text-sm">
          <For each={m().filteredSessions()}>
            {(s) => (
              <li class="rounded-md border border-border/60 bg-muted/30 px-3 py-2.5">
                <div class="flex items-start justify-between gap-3">
                  <p class="text-xs text-muted-foreground whitespace-nowrap">
                    {formatSessionRange(s.startedAtMs, s.endedAtMs, t)}
                  </p>
                  <Badge
                    variant={statusVariant(s.state)}
                    round
                    class="h-5 px-2 text-[10px] font-black uppercase tracking-wider"
                  >
                    {s.state}
                  </Badge>
                </div>
                <p class="mt-1.5 break-all font-mono text-[11px] text-foreground/90">
                  {s.command ?? "—"}
                </p>
              </li>
            )}
          </For>
        </ul>
      </div>
    </div>
  );
}
