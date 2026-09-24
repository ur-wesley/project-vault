import { For, Show, type Component } from "solid-js";
import type { Accessor } from "solid-js";

import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import type { useI18n } from "~/lib/i18n-context";
import type { ProjectDto } from "~/types/dto";
import type { ProjectDetailModel } from "../model/createProjectDetailModel";

type T = ReturnType<typeof useI18n>["t"];

/**
 * IDE open/stop pill with selector dropdown.
 * (Extracted verbatim from ProjectDetailHeader.)
 */
export const HeaderIdePill: Component<{
  t: T;
  m: Accessor<ProjectDetailModel>;
  p: Accessor<ProjectDto>;
}> = (props) => {
  const { t, m, p } = props;

  return (
    <Show when={(m().idesQ.data?.length ?? 0) > 0}>
      <div class="flex items-center rounded-full bg-primary/10 p-px ring-1 ring-primary/20 transition-all hover:ring-primary/40">
        <Show
          when={m().ideRunningQ.data === true}
          fallback={
            <button
              type="button"
              class={cn(
                "flex h-7 items-center gap-1.5 rounded-l-full pl-3 pr-2.5 text-[10px] font-bold uppercase tracking-wide text-primary transition-colors hover:bg-primary/10 active:scale-95",
                m().selectedIdeExecutable() == null && "pointer-events-none opacity-30 grayscale",
              )}
              onClick={() => {
                const ex = m().selectedIdeExecutable();
                if (ex) void m().onOpenIde(p().id, ex);
              }}
            >
              <Show
                when={m().selectedIdeOption()?.iconData}
                fallback={
                  <Show when={m().selectedIdeOption()?.icon}>
                    <span class={cn("iconify size-4.5 shrink-0", m().selectedIdeOption()?.icon)} />
                  </Show>
                }
              >
                {(src) => <img src={src()} alt="" class="size-4.5 shrink-0 object-contain" />}
              </Show>
              <span class="max-w-[120px] truncate">
                {m().selectedIdeOption()?.label ?? (t("library.openInIde") as string)}
              </span>
              <span class="iconify mdi--play size-4" />
            </button>
          }
        >
          <button
            type="button"
            class="flex h-7 animate-in fade-in slide-in-from-right-0.5 items-center gap-1.5 rounded-l-full pl-3 pr-2.5 text-[10px] font-bold uppercase tracking-wide text-destructive transition-colors duration-300 hover:bg-destructive/10 active:scale-95"
            onClick={() => void m().onStopIde(p().id)}
          >
            <span class="iconify mdi--stop size-3.5" />
            <span>{t("library.stopIde") as string}</span>
          </button>
        </Show>
        <div class="mx-0.5 h-4 w-px bg-primary/20" />
        <DropdownMenu gutter={8}>
          <DropdownMenuTrigger
            as={Button}
            variant="ghost"
            size="icon"
            class="size-7 rounded-r-full text-primary transition-colors hover:bg-primary/10 focus:ring-0"
          >
            <span class="iconify mdi--chevron-down size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent class="w-56 p-1.5 shadow-xl border-border/40">
            <For each={m().ideSelectOptions()}>
              {(opt) => (
                <DropdownMenuItem
                  class="flex cursor-pointer items-center gap-2 px-2.5 py-2"
                  onClick={() => m().onIdeSelected(p().id, opt.executable)}
                >
                  <Show
                    when={opt.iconData}
                    fallback={
                      <Show when={opt.icon}>
                        <span
                          class={cn("iconify size-4 shrink-0 text-muted-foreground", opt.icon)}
                        />
                      </Show>
                    }
                  >
                    {(src) => <img src={src()} alt="" class="size-4 shrink-0 object-contain" />}
                  </Show>
                  <span class="flex-1 text-xs font-bold tracking-tight text-foreground">
                    {opt.label}
                  </span>
                  <Show when={m().selectedIdeExecutable() === opt.executable}>
                    <span class="iconify mdi--check size-3.5 text-primary" />
                  </Show>
                </DropdownMenuItem>
              )}
            </For>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Show>
  );
};
