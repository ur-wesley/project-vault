import { onMount, type Accessor, Show, createSignal, type Component, onCleanup } from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";
import { platform } from "@tauri-apps/plugin-os";

import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { SidebarTrigger } from "~/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { useI18n } from "~/lib/i18n-context";
import { cn } from "~/lib/utils";

type WindowTitleBarProps = Readonly<{
  title: Accessor<string>;
}>;

function isMacOSPlatform(): boolean {
  return isTauri() && (platform() === "macos" || platform() === "ios");
}

const MacWindowDots: Component<{
  onClose: () => void;
  onMinimize: () => void;
  onMaximize: () => void;
}> = (props) => {
  const { t } = useI18n();
  return (
    <div class="flex shrink-0 items-center gap-2 pl-1.5" data-tauri-drag-region="false">
      <Tooltip>
        <TooltipTrigger
          as="button"
          type="button"
          class="h-3 w-3 shrink-0 rounded-full bg-[#ff5f57] opacity-90 transition-opacity hover:opacity-100"
          onClick={props.onClose}
          aria-label={t('window.close') as string}
        />
        <TooltipContent>{t('window.close') as string}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          as="button"
          type="button"
          class="h-3 w-3 shrink-0 rounded-full bg-[#ffbd2e] opacity-90 transition-opacity hover:opacity-100"
          onClick={props.onMinimize}
          aria-label={t('window.minimize') as string}
        />
        <TooltipContent>{t('window.minimize') as string}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          as="button"
          type="button"
          class="h-3 w-3 shrink-0 rounded-full bg-[#28c840] opacity-90 transition-opacity hover:opacity-100"
          onClick={props.onMaximize}
          aria-label={t('window.zoom') as string}
        />
        <TooltipContent>{t('window.zoom') as string}</TooltipContent>
      </Tooltip>
    </div>
  );
};

const WinWindowControls: Component<{
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
  maximized: boolean;
}> = (props) => {
  const { t } = useI18n();
  return (
    <div
      class="flex h-full min-h-8 shrink-0 items-stretch border-s border-border/60"
      data-tauri-drag-region="false"
    >
      <Button
        type="button"
        variant="ghost"
        class="h-full rounded-none px-2.5 text-muted-foreground hover:bg-muted/80"
        onClick={props.onMinimize}
        aria-label={t('window.minimize') as string}
      >
        <span class="iconify mdi--window-minimize h-3.5 w-3.5" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        class="h-full rounded-none px-2.5 text-muted-foreground hover:bg-muted/80"
        onClick={props.onMaximize}
        aria-label={props.maximized ? (t('window.restore') as string) : (t('window.maximize') as string)}
      >
        <span
          class={
            props.maximized
              ? "iconify mdi--window-restore h-3.5 w-3.5"
              : "iconify mdi--window-maximize h-3.5 w-3.5"
          }
          aria-hidden="true"
        />
      </Button>
      <Button
        type="button"
        variant="ghost"
        class="h-full rounded-none px-2.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
        onClick={props.onClose}
        aria-label={t('window.close') as string}
      >
        <span class="iconify mdi--close h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
};

export const WindowTitleBar: Component<WindowTitleBarProps> = (props) => {
  const isMac = () => isMacOSPlatform();
  const [maximized, setMaximized] = createSignal(false);

  const w = () => (isTauri() ? getCurrentWindow() : null);

  const syncMaximized = async () => {
    const win = w();
    if (win) setMaximized(await win.isMaximized());
  };

  onMount(() => {
    if (!isTauri()) return;
    const win = w();
    if (!win) return;
    let unlisten: (() => void) | undefined;
    void (async () => {
      unlisten = await win.onResized(() => {
        void syncMaximized();
      });
    })();
    void syncMaximized();
    onCleanup(() => {
      unlisten?.();
    });
  });

  const minimize = () => void w()?.minimize();
  const toggleMax = () => {
    void w()
      ?.toggleMaximize()
      .then(() => syncMaximized());
  };
  const close = () => void w()?.close();

  return (
    <header
      data-tauri-drag-region
      class={cn(
        "flex h-9 min-h-9 w-full shrink-0 select-none items-stretch border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 fixed top-0 left-0 right-0 z-50",
        isTauri() && isMac() ? "pt-1" : "pt-0.5",
      )}
    >
      <Show when={isTauri() && isMac()}>
        <MacWindowDots onClose={close} onMinimize={minimize} onMaximize={toggleMax} />
      </Show>
      <div
        class="flex h-full min-h-0 shrink-0 items-center gap-0.5 px-0.5"
        data-tauri-drag-region="false"
      >
        <SidebarTrigger class="size-7 shrink-0" />
        <Separator orientation="vertical" class="h-4" />
      </div>
      <div
        class="flex min-h-0 min-w-0 flex-1 items-center self-stretch justify-center overflow-hidden px-2"
        data-tauri-drag-region
      >
        <span
          data-tauri-drag-region
          class="w-full min-w-0 max-w-sm truncate text-center text-xs font-medium text-foreground sm:max-w-md sm:text-sm"
        >
          {props.title()}
        </span>
      </div>
      <div class="flex shrink-0 items-stretch" data-tauri-drag-region="false">
        <div id="window-title-bar-actions" class="flex items-stretch" />
      </div>
      <Show when={isTauri() && !isMac()}>
        <WinWindowControls
          onMinimize={minimize}
          onMaximize={toggleMax}
          onClose={close}
          maximized={maximized()}
        />
      </Show>
    </header>
  );
};
