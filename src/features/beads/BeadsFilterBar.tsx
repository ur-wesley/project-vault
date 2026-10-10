import { Show, type Component } from "solid-js";

import { Button } from "~/components/ui/button";
import { TextField, TextFieldInput } from "~/components/ui/text-field";
import { useI18n } from "~/lib/i18n-context";
import {
  BEADS_ISSUE_TYPES,
  BEADS_STATUS_COLUMNS,
  EMPTY_BEADS_FILTERS,
  PRIORITY_MAP,
  type BeadsFilters,
  type BeadsViewLayout,
} from "./types";

type Props = {
  filters: BeadsFilters;
  layout: BeadsViewLayout;
  onFilters: (f: BeadsFilters) => void;
  onLayout: (l: BeadsViewLayout) => void;
  onCreateOpen: () => void;
};

export const BeadsFilterBar: Component<Props> = (props) => {
  const { t } = useI18n();

  const set = (patch: Partial<BeadsFilters>) => props.onFilters({ ...props.filters, ...patch });

  const hasActiveFilters = () =>
    Boolean(
      props.filters.search ||
        props.filters.issueType ||
        props.filters.priority ||
        props.filters.status ||
        props.filters.onlyReady ||
        props.filters.onlyBlocked,
    );

  return (
    <div class="flex flex-wrap items-center gap-2">
      <TextField class="w-48">
        <TextFieldInput
          placeholder={t("beads.filterSearch") as string}
          class="h-8 text-xs"
          value={props.filters.search}
          onInput={(e) => set({ search: e.currentTarget.value })}
          autocomplete="off"
        />
      </TextField>

      {/* Type Selector */}
      <select
        class="h-8 rounded-md border border-input bg-background px-2 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={props.filters.issueType}
        onChange={(e) => set({ issueType: e.currentTarget.value })}
        aria-label={t("beads.filterType") as string}
      >
        <option value="">{t("beads.allTypes") as string}</option>
        {BEADS_ISSUE_TYPES.map((type) => (
          <option value={type}>{type}</option>
        ))}
      </select>

      {/* Priority Selector */}
      <select
        class="h-8 rounded-md border border-input bg-background px-2 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={props.filters.priority}
        onChange={(e) => set({ priority: e.currentTarget.value })}
        aria-label={t("beads.filterPriority") as string}
      >
        <option value="">{t("beads.allPriorities") as string}</option>
        {Object.entries(PRIORITY_MAP).map(([p, meta]) => (
          <option value={p}>{meta.label}</option>
        ))}
      </select>

      {/* Status Selector */}
      <select
        class="h-8 rounded-md border border-input bg-background px-2 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={props.filters.status}
        onChange={(e) => set({ status: e.currentTarget.value })}
        aria-label={t("beads.filterStatus") as string}
      >
        <option value="">{t("beads.allStatuses") as string}</option>
        {BEADS_STATUS_COLUMNS.map((status) => (
          <option value={status}>{status}</option>
        ))}
      </select>

      {/* Blocked only toggle */}
      <Button
        size="sm"
        variant={props.filters.onlyBlocked ? "default" : "outline"}
        class="h-8 text-xs gap-1"
        onClick={() => set({ onlyBlocked: !props.filters.onlyBlocked })}
      >
        <span class="iconify mdi--lock-outline size-3.5" />
        {t("beads.filterBlocked") as string}
      </Button>

      <Show when={hasActiveFilters()}>
        <Button
          size="sm"
          variant="ghost"
          class="h-8 text-xs"
          onClick={() => props.onFilters({ ...EMPTY_BEADS_FILTERS })}
        >
          {t("beads.clearFilters") as string}
        </Button>
      </Show>

      <div class="ml-auto flex items-center gap-2">
        {/* Layout switcher: Board / List */}
        <div class="flex overflow-hidden rounded-md border">
          <Button
            size="sm"
            variant={props.layout === "board" ? "default" : "ghost"}
            class="h-8 rounded-none text-xs gap-1"
            onClick={() => props.onLayout("board")}
          >
            <span class="iconify mdi--view-column-outline size-3.5" />
            {t("beads.layoutBoard") as string}
          </Button>
          <Button
            size="sm"
            variant={props.layout === "list" ? "default" : "ghost"}
            class="h-8 rounded-none text-xs gap-1"
            onClick={() => props.onLayout("list")}
          >
            <span class="iconify mdi--format-list-bulleted size-3.5" />
            {t("beads.layoutList") as string}
          </Button>
        </div>

        {/* New Bead button */}
        <Button size="sm" class="h-8 text-xs gap-1.5" onClick={props.onCreateOpen}>
          <span class="iconify mdi--plus size-3.5" />
          {t("beads.newBead") as string}
        </Button>
      </div>
    </div>
  );
};
