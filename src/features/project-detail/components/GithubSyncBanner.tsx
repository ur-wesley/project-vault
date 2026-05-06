import { Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { useI18n } from "~/lib/i18n-context";

export function GithubSyncBanner(props: {
  count: number;
  syncPending: boolean;
  onSync: () => void;
  onDismiss: () => void;
  onDiscard: () => void;
}) {
  const { t } = useI18n();

  return (
    <div class="mb-6 flex flex-col gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4 shadow-sm animate-in fade-in slide-in-from-top-2 relative">
      <div class="flex items-start justify-between gap-4">
        <div class="space-y-1">
          <h4 class="text-sm font-bold text-primary">
            {t("projectDetail.localIssuesDetected") as string}
          </h4>
          <p class="text-xs text-muted-foreground leading-relaxed">
            {t("projectDetail.localIssuesSyncDescription", { count: props.count }) as string}
          </p>
        </div>
        <span class="iconify mdi--cloud-sync-outline h-8 w-8 text-primary/30 shrink-0" />
      </div>
      <div class="flex items-center gap-2">
        <Button
          size="sm"
          class="h-8 gap-1.5 px-4"
          onClick={() => props.onSync()}
          disabled={props.syncPending}
        >
          <Show when={props.syncPending} fallback={<span class="iconify mdi--cloud-upload h-4 w-4" />}>
            <span class="iconify mdi--cloud-upload h-4 w-4" />
          </Show>
          {t("projectDetail.syncToGithub") as string}
        </Button>
        <Button
          variant="outline"
          size="sm"
          class="h-8 px-4 text-xs"
          onClick={() => props.onDismiss()}
        >
          {t("common.dismiss") as string}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="h-8 px-4 text-xs text-muted-foreground hover:text-destructive"
          onClick={() => props.onDiscard()}
        >
          {t("projectDetail.discardLocal") as string}
        </Button>
      </div>
    </div>
  );
}
