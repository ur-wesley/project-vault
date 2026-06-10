import { Show, type Component } from "solid-js";

import { useI18n } from "~/lib/i18n-context";

import { MoveProjectDialog } from "./components/MoveProjectDialog";
import { MiseToolsSuggestion } from "./components/MiseToolsSuggestion";
import { ProjectDetailBanners } from "./components/ProjectDetailBanners";
import { ProjectDetailHeader } from "./components/ProjectDetailHeader";
import { ProjectDetailShortcutListener } from "./components/ProjectDetailShortcutListener";
import { ProjectMainTabs } from "./components/ProjectMainTabs";
import { RiskConfirmDialog } from "./components/RiskConfirmDialog";
import { createProjectDetailModel } from "./model/createProjectDetailModel";
import type { ProjectDetailViewProps } from "./types";

const ProjectDetailView: Component<ProjectDetailViewProps> = (props) => {
  const { t } = useI18n();
  const model = createProjectDetailModel(props);
  return (
    <div class="flex min-h-0 flex-1 flex-col gap-3">
      <ProjectDetailShortcutListener
        detailTab={props.detailTab}
        onDetailTabChange={props.onDetailTabChange}
      />
      <ProjectDetailBanners model={model} />
      <ProjectDetailHeader model={model} />
      <Show when={model.projectQ.isPending}>
        <p class="p-6 text-sm text-muted-foreground">{t("library.loading") as string}</p>
      </Show>
      <Show when={model.projectQ.isError}>
        <p class="p-6 text-sm text-destructive">{t("library.error") as string}</p>
      </Show>
      <Show when={!model.miseSuggestionsDismissed() && model.miseSuggestionsQ.data && (model.miseSuggestionsQ.data?.length ?? 0) > 0}>
        <div class="px-4">
          <MiseToolsSuggestion
            suggestions={model.miseSuggestionsQ.data ?? []}
            isLoading={model.miseSuggestionsQ.isLoading}
            isPending={model.pinMiseToolsMu.isPending}
            onPin={(tools) => model.pinMiseToolsMu.mutate(tools)}
            onDismiss={model.dismissMiseSuggestions}
          />
        </div>
      </Show>
      <Show when={model.projectQ.data}>
        <div class="min-h-0 flex-1 overflow-hidden">
          <ProjectMainTabs model={model} project={() => model.projectQ.data!} />
        </div>
      </Show>
      <RiskConfirmDialog model={model} />
      <Show when={model.projectQ.data}>
        <MoveProjectDialog model={model} project={() => model.projectQ.data!} />
      </Show>
    </div>
  );
};

export { ProjectDetailView };
