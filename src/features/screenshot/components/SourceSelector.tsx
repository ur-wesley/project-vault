import { type Component, For, Show, createSignal } from "solid-js";
import { Button } from "~/components/ui/button";
import { useI18n } from "~/lib/i18n-context";
import type { ScreenInfoDto, WindowInfoDto } from "~/types/dto";

export type CaptureSource =
  | { type: "screen"; monitorId: number }
  | { type: "all-screens" }
  | { type: "window"; windowId: number }
  | { type: "region" };

interface SourceSelectorProps {
  screens: ScreenInfoDto[];
  windows: WindowInfoDto[];
  onSelect: (source: CaptureSource) => void;
  onClose: () => void;
}

const SourceSelector: Component<SourceSelectorProps> = (props) => {
  const { t } = useI18n();
  const [tab, setTab] = createSignal<"screen" | "window">("screen");

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm">
      <div class="w-[420px] max-h-[80vh] flex flex-col rounded-xl border border-border bg-background shadow-2xl">
        <div class="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 class="text-sm font-semibold">{t("screenshot.title")}</h3>
          <Button variant="ghost" size="icon" class="size-7" onClick={props.onClose}>
            <span class="iconify mdi--close size-4" />
          </Button>
        </div>

        <div class="flex border-b border-border">
          <button
            type="button"
            class="flex-1 px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-colors"
            classList={{
              "text-primary border-b-2 border-primary": tab() === "screen",
              "text-muted-foreground hover:text-foreground": tab() !== "screen",
            }}
            onClick={() => setTab("screen")}
          >
            <span class="iconify mdi--monitor-screenshot mr-1.5 size-4" />
            {t("screenshot.tabScreen")}
          </button>
          <button
            type="button"
            class="flex-1 px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-colors"
            classList={{
              "text-primary border-b-2 border-primary": tab() === "window",
              "text-muted-foreground hover:text-foreground": tab() !== "window",
            }}
            onClick={() => setTab("window")}
          >
            <span class="iconify mdi--window-restore mr-1.5 size-4" />
            {t("screenshot.tabWindow")}
          </button>
        </div>

        <div class="flex-1 overflow-y-auto p-3">
          <Show when={tab() === "screen"}>
            <div class="flex flex-col gap-1.5">
              <For each={props.screens}>
                {(screen) => (
                  <button
                    type="button"
                    class="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:bg-accent"
                    onClick={() => props.onSelect({ type: "screen", monitorId: screen.id })}
                  >
                    <span class="iconify mdi--monitor size-5 text-muted-foreground" />
                    <div class="flex-1 min-w-0">
                      <div class="text-sm font-medium truncate">{screen.name}</div>
                      <div class="text-[11px] text-muted-foreground">
                        {screen.width}x{screen.height}
                        {screen.isPrimary ? ` ${t("screenshot.primary")}` : ""}
                      </div>
                    </div>
                  </button>
                )}
              </For>
              <Show when={props.screens.length > 1}>
                <button
                  type="button"
                  class="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:bg-accent"
                  onClick={() => props.onSelect({ type: "all-screens" })}
                >
                  <span class="iconify mdi--monitor-multiple size-5 text-muted-foreground" />
                  <div class="flex-1 min-w-0">
                    <div class="text-sm font-medium">{t("screenshot.allScreens")}</div>
                    <div class="text-[11px] text-muted-foreground">
                      {t("screenshot.allScreensDesc")}
                    </div>
                  </div>
                </button>
              </Show>
              <div class="mt-2 border-t border-border pt-2">
                <button
                  type="button"
                  class="flex w-full items-center gap-3 rounded-lg border border-dashed border-border px-3 py-2.5 text-left transition-colors hover:bg-accent"
                  onClick={() => props.onSelect({ type: "region" })}
                >
                  <span class="iconify mdi--crop size-5 text-muted-foreground" />
                  <div class="flex-1 min-w-0">
                    <div class="text-sm font-medium">{t("screenshot.selectRegion")}</div>
                    <div class="text-[11px] text-muted-foreground">
                      {t("screenshot.selectRegionDesc")}
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </Show>

          <Show when={tab() === "window"}>
            <div class="flex flex-col gap-1.5">
              <For each={props.windows}>
                {(win) => (
                  <button
                    type="button"
                    class="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:bg-accent"
                    onClick={() => props.onSelect({ type: "window", windowId: win.id })}
                  >
                    <span class="iconify mdi--application-outline size-5 text-muted-foreground" />
                    <div class="flex-1 min-w-0">
                      <div class="text-sm font-medium truncate">{win.title}</div>
                      <div class="text-[11px] text-muted-foreground truncate">
                        {win.appName} &middot; {win.width}x{win.height}
                      </div>
                    </div>
                  </button>
                )}
              </For>
              <Show when={props.windows.length === 0}>
                <p class="py-4 text-center text-xs text-muted-foreground">
                  {t("screenshot.noWindows")}
                </p>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
};

export default SourceSelector;
