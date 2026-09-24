import { Button } from "~/components/ui/button";
import { useI18n } from "~/lib/i18n-context";

import type { FileTabsModel } from "../model/fileTabsModel";

/** Banner shown when a dirty file changed on disk: reload or keep mine. */
export function ExternalChangeBanner(props: { model: FileTabsModel; activePath: string }) {
  const { t } = useI18n();

  return (
    <div class="flex shrink-0 items-center justify-between gap-2 border-b border-warning/30 bg-warning/10 px-3 py-1.5">
      <span class="text-[10px] text-warning">
        {t("projectDetail.fileChangedExternally") as string}
      </span>
      <div class="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          class="h-6 px-2 text-[10px]"
          onClick={() => void props.model.reload(props.activePath)}
        >
          {t("projectDetail.reloadFromDisk") as string}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          class="h-6 px-2 text-[10px] text-muted-foreground"
          onClick={() => props.model.dismissExternal(props.activePath)}
        >
          {t("projectDetail.keepMine") as string}
        </Button>
      </div>
    </div>
  );
}
