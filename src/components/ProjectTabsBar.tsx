import { For, Show, createEffect, type Component } from "solid-js";
import { DndSortableItem, DndSortableRoot, snapshotTransform } from "~/components/dnd";
import type { ReorderEvent } from "~/components/dnd";
import { useI18n } from "~/lib/i18n-context";
import { getPinnedProjects, movePinnedProject, setPinnedProjects } from "~/lib/project-pins";
import { cn } from "~/lib/utils";
import type { ProjectDto } from "~/types/dto";

export type PinnedTabProject = Pick<ProjectDto, "id" | "name" | "path" | "stack" | "iconPath"> & {
  running?: boolean;
};

type ProjectTabsBarProps = Readonly<{
  tabs: PinnedTabProject[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onUnpin: (id: string) => void;
}>;

const TabFace: Component<{ tab: PinnedTabProject }> = (props) => (
  <span class="flex min-w-0 flex-1 items-center gap-1.5">
    <Show when={props.tab.running}>
      <span
        class="size-1.5 shrink-0 rounded-full bg-green-500"
        aria-hidden="true"
        title="Running"
      />
    </Show>
    <span class="min-w-0 flex-1 truncate text-xs font-medium">{props.tab.name}</span>
  </span>
);

export const ProjectTabsBar: Component<ProjectTabsBarProps> = (props) => {
  const { t } = useI18n();
  // eslint-disable-next-line no-unassigned-vars -- Solid ref pattern
  let scrollRef: HTMLDivElement | undefined;

  createEffect(() => {
    const active = props.activeId;
    if (!active || !scrollRef) return;
    const el = scrollRef.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(active)}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  });

  const handleReorder = (e: ReorderEvent) => {
    setPinnedProjects(movePinnedProject(getPinnedProjects(), e.activeId, e.overId));
  };

  const ghost = (id: string) => {
    const tab = props.tabs.find((tab) => tab.id === id);
    if (!tab) return null;
    return (
      <div class="flex h-8 items-center gap-1.5 rounded-t-lg border border-b-0 border-border/60 bg-background px-2.5 shadow-lg">
        <TabFace tab={tab} />
      </div>
    );
  };

  return (
    <DndSortableRoot
      ids={props.tabs.map((tab) => tab.id)}
      orientation="horizontal"
      ignoreSelector="[data-tab-close]"
      onReorder={handleReorder}
      overlay={ghost}
    >
      <div
        ref={scrollRef}
        class="flex min-h-0 w-full flex-1 items-end gap-0.5 overflow-x-auto overflow-y-hidden px-2 pt-1.5 scrollbar-none"
        data-tauri-drag-region="false"
        role="tablist"
        aria-label="Pinned projects"
      >
        <Show
          when={props.tabs.length > 0}
          fallback={
            <span class="truncate px-1 pb-1.5 text-[11px] text-muted-foreground/70">
              {t("settings.tabsEmpty") as string}
            </span>
          }
        >
          <For each={props.tabs}>
            {(tab) => (
              <DndSortableItem id={tab.id}>
                {({ setRef, snapshot, transition, dragListeners }) => {
                  const active = () => props.activeId === tab.id;
                  return (
                    <div
                      ref={setRef}
                      data-tab-id={tab.id}
                      role="tab"
                      aria-selected={active()}
                      {...dragListeners}
                      style={{
                        transform: snapshotTransform(snapshot()),
                        transition,
                      }}
                      class={cn(
                        "group relative flex h-8 max-w-44 shrink-0 cursor-grab items-center rounded-t-lg rounded-b-none border border-b-0 pl-2.5 pr-2 transition-colors",
                        active()
                          ? "border-border/60 bg-background text-foreground shadow-sm"
                          : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                        snapshot().isActive && "cursor-grabbing opacity-40",
                        snapshot().isOver && "ring-1 ring-inset ring-primary/50",
                      )}
                    >
                      <Show when={active()}>
                        <span
                          class="absolute inset-x-2 top-0 h-0.5 rounded-full bg-primary"
                          aria-hidden="true"
                        />
                      </Show>
                      <button
                        type="button"
                        class="flex min-w-0 flex-1 items-center text-left group-hover:[mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)]"
                        onClick={() => {
                          if (!active()) props.onSelect(tab.id);
                        }}
                        title={tab.name}
                      >
                        <TabFace tab={tab} />
                      </button>
                      <button
                        type="button"
                        data-tab-close
                        class="absolute right-1 top-1/2 size-5 -translate-y-1/2 rounded-full p-0 opacity-0 hover:bg-foreground/15 hover:drop-shadow-sm group-hover:opacity-100 focus-visible:opacity-100"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          props.onUnpin(tab.id);
                        }}
                        title={t("settings.tabsUnpin") as string}
                        aria-label={t("settings.tabsUnpin") as string}
                      >
                        <span class="iconify mdi--close size-3" />
                      </button>
                    </div>
                  );
                }}
              </DndSortableItem>
            )}
          </For>
        </Show>
      </div>
    </DndSortableRoot>
  );
};
