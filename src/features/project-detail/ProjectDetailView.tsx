import { Show, type Component } from "solid-js";

import { useI18n } from "~/lib/i18n-context";

import { MoveProjectDialog } from "./components/MoveProjectDialog";
import { ProjectDetailBanners } from "./components/ProjectDetailBanners";
import { ProjectDetailHeader } from "./components/ProjectDetailHeader";
import { ProjectMainTabs } from "./components/ProjectMainTabs";
import { RiskConfirmDialog } from "./components/RiskConfirmDialog";
import { createProjectDetailModel } from "./model/createProjectDetailModel";
import type { ProjectDetailViewProps } from "./types";

const ProjectDetailView: Component<ProjectDetailViewProps> = (props) => {
  const { t } = useI18n();
  const model = createProjectDetailModel(props);
  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <ProjectDetailBanners model={model} />
      <ProjectDetailHeader model={model} />
      <Show when={model.projectQ.isPending}>
        <p class="p-6 text-sm text-muted-foreground">{t("library.loading") as string}</p>
      </Show>
      <Show when={model.projectQ.isError}>
        <p class="p-6 text-sm text-destructive">{t("library.error") as string}</p>
      </Show>
      <Show when={model.projectQ.data}>
        {(project) => (
          <div class="min-h-0 flex-1 overflow-hidden p-4">
            <ProjectMainTabs model={model} project={project} />
          </div>
        )}
      </Show>
      <RiskConfirmDialog model={model} />
      <Show when={model.projectQ.data}>
        {(p) => <MoveProjectDialog model={model} project={p} />}
      </Show>
    </div>
  );
};

export { ProjectDetailView };
