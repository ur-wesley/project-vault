import { createSignal, createResource, Show, type Component } from "solid-js";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { toast } from "solid-sonner";
import { useI18n } from "~/lib/i18n-context";
import { notify } from "~/lib/notification-center";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { installUpdate, type UpdateInfoDto } from "~/services/tauri/updates";
import { stableErrorMessage } from "~/lib/invoke-error";

const SKIPPED_UPDATE_KEY = "project-vault:skipped-update";

export function getSkippedVersion(): string | null {
  try {
    return localStorage.getItem(SKIPPED_UPDATE_KEY);
  } catch {
    return null;
  }
}

export function setSkippedVersion(version: string) {
  try {
    localStorage.setItem(SKIPPED_UPDATE_KEY, version);
  } catch {
    // ignore
  }
}

export const UpdateDialog: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  updateInfo: UpdateInfoDto | null;
  onSkipped?: () => void;
}> = (props) => {
  const { t } = useI18n();
  const [installing, setInstalling] = createSignal(false);

  const [notesHtml] = createResource(
    () => props.updateInfo?.notes ?? "",
    async (notes) => {
      if (!notes) return "";
      const parsed = await marked.parse(notes);
      return DOMPurify.sanitize(parsed);
    },
  );

  const onInstall = async () => {
    setInstalling(true);
    try {
      const r = await installUpdate();
      if (r.isErr()) {
        toast.error(stableErrorMessage(t, r.error));
      } else {
        notify({
          severity: "info",
          title: t("updater.installRestarting") as string,
          source: "Updater",
          system: "auto",
        });
      }
    } catch (e) {
      toast.error(`${t("updater.installFailed")}: ${String(e)}`);
    } finally {
      setInstalling(false);
    }
  };

  const onSkip = () => {
    const version = props.updateInfo?.version;
    if (version) setSkippedVersion(version);
    props.onOpenChange(false);
    props.onSkipped?.();
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent class="max-w-sm">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <span class="iconify mdi--download-circle-outline size-5 text-primary" />
            {t("updater.available")}
          </DialogTitle>
          <Show when={props.updateInfo}>
            <DialogDescription>
              {t("updater.newVersion", { version: props.updateInfo!.version })}
            </DialogDescription>
          </Show>
        </DialogHeader>

        <Show when={props.updateInfo?.notes}>
          <div class="max-h-48 overflow-y-auto rounded-md bg-muted/30 p-3 prose prose-sm dark:prose-invert !text-xs">
            <Show when={notesHtml()} fallback={<p class="animate-pulse text-muted-foreground text-xs">{t("common.rendering") as string}</p>}>
              <article class="markdown-body !bg-transparent !p-0 !text-xs" innerHTML={notesHtml()!} />
            </Show>
          </div>
        </Show>

        <DialogFooter class="gap-2 sm:gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={installing()}
            onClick={() => void onSkip()}
          >
            {t("updater.skipVersion")}
          </Button>
          <Button
            size="sm"
            disabled={installing()}
            onClick={() => void onInstall()}
          >
            <Show when={installing()}>
              <span class="iconify mdi--loading mr-2 size-4 animate-spin" />
            </Show>
            {t("updater.install")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
