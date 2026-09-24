import { Show, type Component } from "solid-js";

import { Button } from "~/components/ui/button";
import { TextField, TextFieldInput } from "~/components/ui/text-field";
import { useI18n } from "~/lib/i18n-context";
import { KanbanSelect } from "./KanbanSelect";
import {
  KANBAN_ALL_STATUSES,
  KANBAN_PRIORITIES,
  KANBAN_SORT_MODES,
  type KanbanSortMode,
} from "./types";

export type KanbanFilters = {
  search: string;
  status: string;
  priority: string;
  tag: string;
  assignee: string;
};

export const EMPTY_FILTERS: KanbanFilters = {
  search: "",
  status: "",
  priority: "",
  tag: "",
  assignee: "",
};

type Props = Readonly<{
  filters: KanbanFilters;
  sort: KanbanSortMode;
  tagOptions: string[];
  assigneeOptions: string[];
  showAll: boolean;
  view: "board" | "list";
  onFilters: (f: KanbanFilters) => void;
  onSort: (s: KanbanSortMode) => void;
  onShowAll: (v: boolean) => void;
  onView: (v: "board" | "list") => void;
}>;

export const KanbanFilterBar: Component<Props> = (props) => {
  const { t } = useI18n();
  const set = (patch: Partial<KanbanFilters>) => props.onFilters({ ...props.filters, ...patch });
  const active =
    props.filters.search !== "" ||
    props.filters.status !== "" ||
    props.filters.priority !== "" ||
    props.filters.tag !== "" ||
    props.filters.assignee !== "";

  return (
    <div class="flex flex-wrap items-end gap-1.5">
      <TextField class="w-44">
        <TextFieldInput
          placeholder={t("kanban.filterSearch") as string}
          class="h-8 text-xs"
          value={props.filters.search}
          onInput={(e) => set({ search: e.currentTarget.value })}
          autocomplete="off"
        />
      </TextField>
      <KanbanSelect
        ariaLabel={t("kanban.filterStatus") as string}
        label={t("kanban.filterStatus") as string}
        placeholder={t("kanban.filterStatus") as string}
        value={props.filters.status}
        options={[
          { value: "", label: t("kanban.filterStatus") as string },
          ...KANBAN_ALL_STATUSES.map((s) => ({ value: s, label: s })),
        ]}
        onChange={(v) => set({ status: v })}
        class="w-32"
      />
      <KanbanSelect
        ariaLabel={t("kanban.filterPriority") as string}
        label={t("kanban.filterPriority") as string}
        placeholder={t("kanban.filterPriority") as string}
        value={props.filters.priority}
        options={[
          { value: "", label: t("kanban.filterPriority") as string },
          ...KANBAN_PRIORITIES.map((p) => ({ value: p, label: p })),
        ]}
        onChange={(v) => set({ priority: v })}
        class="w-32"
      />
      <KanbanSelect
        ariaLabel={t("kanban.filterTag") as string}
        label={t("kanban.filterTag") as string}
        placeholder={t("kanban.filterTag") as string}
        value={props.filters.tag}
        options={[
          { value: "", label: t("kanban.filterTag") as string },
          ...props.tagOptions.map((tag) => ({ value: tag, label: tag })),
        ]}
        onChange={(v) => set({ tag: v })}
        class="w-32"
      />
      <KanbanSelect
        ariaLabel={t("kanban.filterAssignee") as string}
        label={t("kanban.filterAssignee") as string}
        placeholder={t("kanban.filterAssignee") as string}
        value={props.filters.assignee}
        options={[
          { value: "", label: t("kanban.filterAssignee") as string },
          ...props.assigneeOptions.map((a) => ({ value: a, label: a })),
        ]}
        onChange={(v) => set({ assignee: v })}
        class="w-36"
      />
      <KanbanSelect
        ariaLabel={t("kanban.sortBy") as string}
        label={t("kanban.sortBy") as string}
        value={props.sort}
        options={KANBAN_SORT_MODES.map((m) => ({
          value: m,
          label: `${t("kanban.sortBy") as string}: ${m}`,
        }))}
        onChange={(v) => props.onSort(v as KanbanSortMode)}
        class="w-40"
      />
      <Show when={active}>
        <Button
          size="sm"
          variant="ghost"
          class="h-8 text-xs"
          onClick={() => props.onFilters({ ...EMPTY_FILTERS })}
        >
          {t("kanban.clearFilters") as string}
        </Button>
      </Show>
      <div class="ml-auto flex items-center gap-1.5">
        <Button
          size="sm"
          variant={props.showAll ? "default" : "outline"}
          class="h-8 text-xs"
          title={t("kanban.showAllHint") as string}
          onClick={() => props.onShowAll(!props.showAll)}
        >
          {t("kanban.showAll") as string}
        </Button>
        <div class="flex overflow-hidden rounded-md border">
          <Button
            size="sm"
            variant={props.view === "board" ? "default" : "ghost"}
            class="h-8 rounded-none text-xs"
            onClick={() => props.onView("board")}
          >
            {t("kanban.viewBoard") as string}
          </Button>
          <Button
            size="sm"
            variant={props.view === "list" ? "default" : "ghost"}
            class="h-8 rounded-none text-xs"
            onClick={() => props.onView("list")}
          >
            {t("kanban.viewList") as string}
          </Button>
        </div>
      </div>
    </div>
  );
};
