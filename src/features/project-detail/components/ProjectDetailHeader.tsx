import { createQuery } from "@tanstack/solid-query";
import { Show, createMemo, createSignal, type Component } from "solid-js";
import { useI18n } from "~/lib/i18n-context";
import { LanguageBar } from "./LanguageBar";
import { DeleteProjectDialog } from "./DeleteProjectDialog";
import { CleanProjectDialog } from "./CleanProjectDialog";
import { TagVersionDialog } from "./TagVersionDialog";
import { useLivePlaytime } from "~/lib/live-playtime-context";
import { ProjectDiskUsageDialog } from "~/features/library/ProjectDiskUsageDialog";
import { useHeaderGithub } from "../model/useHeaderGithub";
import { usePinnedProjects } from "~/lib/project-pins";
import { HeaderTitle } from "./HeaderTitle";
import { HeaderMetaRow } from "./HeaderMetaRow";
import { HeaderActionsMenu } from "./HeaderActionsMenu";
import { HeaderTitlebarPortal } from "./HeaderTitlebarPortal";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { getSetting } from "~/services/tauri/settings";

import type { ProjectDetailModel } from "../model/createProjectDetailModel";

type ProjectDetailHeaderProps = Readonly<{
  model: ProjectDetailModel;
}>;

// GitHub-like language colors
export const ProjectDetailHeader: Component<ProjectDetailHeaderProps> = (props) => {
  const { t } = useI18n();
  const { getLivePlaytimeMs } = useLivePlaytime();
  const m = () => props.model;
  const p = () => m().projectQ.data!;
  const livePlaytimeMs = createMemo(() => {
    const proj = m().projectQ.data;
    return proj ? getLivePlaytimeMs(proj.id, proj.totalPlaytimeMs)() : 0;
  });
  const github = useHeaderGithub(m);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = createSignal(false);
  const [tagDialogOpen, setTagDialogOpen] = createSignal(false);
  const [cleanDialogOpen, setCleanDialogOpen] = createSignal(false);
  const [incomingOpen, setIncomingOpen] = createSignal(false);
  const [diskUsageOpen, setDiskUsageOpen] = createSignal(false);
  const pins = usePinnedProjects();
  const pinned = createMemo(() => {
    try {
      return pins().includes(p().id);
    } catch {
      return false;
    }
  });
  const tabsEnabledQ = createQuery(() => ({
    queryKey: ["settings", "ui_project_tabs_enabled"] as const,
    queryFn: async () => {
      const r = await getSetting("ui_project_tabs_enabled");
      if (r.isErr()) return true;
      return r.value !== "false";
    },
    staleTime: 30_000,
  }));
  const tabsEnabled = createMemo(() => tabsEnabledQ.data ?? true);

  return (
    <div class="shrink-0 border-b border-border/40 bg-background/50">
      <Show when={m().projectQ.data}>
        <div class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-1 gap-y-0 px-4 py-3">
          <div class="col-start-1 row-start-1 flex shrink-0 items-center gap-1">
            <Tooltip>
              <TooltipTrigger
                as={Button}
                type="button"
                variant="ghost"
                size="sm"
                class="h-7 px-1.5"
                onClick={() => m().props.onBack()}
              >
                <span class="iconify mdi--arrow-left size-4" />
              </TooltipTrigger>
              <TooltipContent>{t("projectDetail.backToLibrary") as string}</TooltipContent>
            </Tooltip>
            <Separator orientation="vertical" class="h-4" />
          </div>
          <div class="col-start-2 row-start-1 min-w-0">
            <HeaderTitle t={t} m={m} p={p} />
          </div>
          <div class="col-start-3 row-start-1 row-span-2 ml-5 self-start">
            <HeaderActionsMenu t={t} m={m} p={p} livePlaytimeMs={livePlaytimeMs} />
          </div>
          <div class="col-start-1 col-span-2 row-start-2 min-w-0">
            <HeaderMetaRow
              t={t}
              m={m}
              p={p}
              github={github}
              onOpenDiskUsage={() => setDiskUsageOpen(true)}
            />
          </div>

          <HeaderTitlebarPortal
            t={t}
            m={m}
            p={p}
            pinned={pinned}
            tabsEnabled={tabsEnabled}
            dialogs={{
              incomingOpen,
              setIncomingOpen,
              setDeleteConfirmOpen,
              setCleanDialogOpen,
              setTagDialogOpen,
            }}
          />
        </div>
      </Show>

      <LanguageBar projectId={m().props.projectId} />

      <TagVersionDialog model={m()} open={tagDialogOpen()} onOpenChange={setTagDialogOpen} />

      <CleanProjectDialog model={m()} open={cleanDialogOpen()} onOpenChange={setCleanDialogOpen} />

      <DeleteProjectDialog
        model={m()}
        open={deleteConfirmOpen()}
        onOpenChange={setDeleteConfirmOpen}
      />

      <Show when={m().projectQ.data}>
        <ProjectDiskUsageDialog
          open={diskUsageOpen()}
          onOpenChange={setDiskUsageOpen}
          projectName={p().name}
          projectPath={p().path}
          projectSizeBytes={p().sizeBytes}
        />
      </Show>
    </div>
  );
};
