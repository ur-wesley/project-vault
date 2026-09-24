import { Show, type Component } from "solid-js";

import { Button } from "~/components/ui/button";
import { DialogShell } from "~/components/DialogShell";
import type { TFunction } from "../model/dialogTypes";
import type { createDeepLinkInstallModel } from "../model/useDeepLinkInstall";

/**
 * Deep-link external-plugin install confirmation on the shared DialogShell.
 * (Extracted verbatim from PluginUiBridge.)
 */
export const DeepLinkDialog: Component<{
  t: TFunction;
  model: ReturnType<typeof createDeepLinkInstallModel>;
}> = (props) => {
  const { t, model } = props;

  return (
    <DialogShell
      open={!!model.deepLinkInstall()}
      onClose={() => model.setDeepLinkInstall(null)}
      title="Install External Plugin"
      contentClass="sm:max-w-[450px]"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => model.setDeepLinkInstall(null)}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" onClick={() => model.installDeepLinkedPlugin()}>
            Install Plugin
          </Button>
        </>
      }
    >
      <div class="py-4 space-y-3">
        <p class="text-xs text-muted-foreground leading-normal">
          An external link is requesting to install a plugin in Project Vault.
        </p>
        <div class="rounded bg-muted/30 border border-border/50 p-3 font-mono text-[10px] break-all space-y-1">
          <div class="flex flex-col">
            <span class="text-muted-foreground font-semibold">Repository:</span>
            <span class="text-foreground select-text">{model.deepLinkInstall()?.repo}</span>
          </div>
          <Show when={model.deepLinkInstall()?.branch}>
            <div class="flex justify-between border-t border-border/20 pt-1 mt-1">
              <span class="text-muted-foreground">Branch:</span>
              <span class="text-foreground">{model.deepLinkInstall()?.branch}</span>
            </div>
          </Show>
          <Show when={model.deepLinkInstall()?.tag}>
            <div class="flex justify-between border-t border-border/20 pt-1 mt-1">
              <span class="text-muted-foreground">Tag:</span>
              <span class="text-foreground">{model.deepLinkInstall()?.tag}</span>
            </div>
          </Show>
          <Show when={model.deepLinkInstall()?.commit}>
            <div class="flex justify-between border-t border-border/20 pt-1 mt-1">
              <span class="text-muted-foreground">Commit:</span>
              <span class="text-foreground">{model.deepLinkInstall()?.commit}</span>
            </div>
          </Show>
        </div>
        <p class="text-[10px] text-amber-500 font-medium leading-normal">
          ⚠️ Warning: Install plugins only from authors you trust. External code can access local
          files.
        </p>
      </div>
    </DialogShell>
  );
};
