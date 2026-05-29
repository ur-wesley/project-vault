import {
  For,
  Show,
  createSignal,
} from "solid-js";
import { createQuery } from "@tanstack/solid-query";
import { toast } from "solid-sonner";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useI18n } from "~/lib/i18n-context";
import { cn } from "~/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { queryKeys } from "~/services/query-keys";
import {
  embeddedTerminalKill,
  globalTerminalSpawn,
  listAvailableShells,
} from "~/services/tauri/terminal";
import { getSetting } from "~/services/tauri/settings";
import { TerminalHost } from "~/components/terminal/TerminalHost";
import { getGlobalTerminalStore } from "~/lib/global-terminal-store";

const SHELL_ICON_MAP: Record<string, string> = {
  powershell: "mdi--powershell",
  pwsh: "mdi--powershell",
  cmd: "mdi--console",
  nu: "mdi--nix",
  bash: "mdi--bash",
  zsh: "mdi--bash",
  fish: "mdi--fish",
  sh: "mdi--console-line",
};

export function GlobalTerminalDrawer() {
  const { t } = useI18n();
  const store = getGlobalTerminalStore();
  const [isDragging, setIsDragging] = createSignal(false);

  const shellsQ = createQuery(() => ({
    queryKey: queryKeys.availableShells,
    queryFn: async () => {
      const r = await listAvailableShells();
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    staleTime: 1000 * 60 * 5,
  }));

  const defaultShellQ = createQuery(() => ({
    queryKey: ["settings", "default_shell_path"] as const,
    queryFn: async () => {
      const r = await getSetting("default_shell_path");
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

  const createInstance = async (name?: string, shell?: string) => {
    const targetShell = shell || defaultShellQ.data || undefined;
    const shellInfo = shellsQ.data?.find((s) => s.executable === targetShell);
    const label =
      name ||
      shellInfo?.label ||
      (targetShell
        ? (t("projectDetail.tabTerminal") as string)
        : (t("globalTerminal.defaultShell") as string));
    const icon = shellInfo
      ? SHELL_ICON_MAP[shellInfo.id.toLowerCase()] || "mdi--console"
      : "mdi--terminal";

    const id = crypto.randomUUID();
    store.setInstances((current) => [
      { id, name: label, shell: targetShell, icon },
      ...current.filter((item) => item.id !== id),
    ]);
    store.setActiveId(id);
  };

  const closeInstance = async (id: string) => {
    const instance = store.instances().find((item) => item.id === id);
    if (!instance) return;

    if (instance.sessionId) {
      const r = await embeddedTerminalKill(instance.sessionId);
      if (r.isErr()) {
        const msg = String(r.error.message ?? r.error);
        if (!msg.toLowerCase().includes("not found")) {
          toast.error(msg);
          return;
        }
      }
    }

    const nextInstances = store.instances().filter((item) => item.id !== id);
    store.setInstances(nextInstances);
    if (store.activeId() === id) {
      store.setActiveId(nextInstances.length > 0 ? nextInstances[0]!.id : null);
    }
  };

  const updateSessionId = (id: string, sessionId: string) => {
    store.setInstances((current) => {
      const item = current.find((i) => i.id === id);
      if (item) {
        item.sessionId = sessionId;
      }
      return [...current];
    });
  };

  const handleMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = store.height();
    let didDrag = false;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = startY - moveEvent.clientY;
      if (Math.abs(deltaY) > 3) didDrag = true;
      const newHeight = startHeight + deltaY;

      const maxHeight = window.innerHeight * 0.9;
      const clampedHeight = Math.max(100, Math.min(newHeight, maxHeight));
      store.setHeight(clampedHeight);

      window.dispatchEvent(new Event("resize"));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      if (!didDrag) {
        store.setOpen(false);
      } else {
        window.dispatchEvent(new Event("resize"));
      }
    };

    setIsDragging(true);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  return (
    <Show when={store.open()}>
      <div
        class="fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-[10px] border border-border/50 bg-background/80 backdrop-blur-xl shadow-2xl transition-[height] duration-200"
        style={{
          height: `${store.height()}px`,
          "transition-duration": isDragging() ? "0ms" : "200ms",
        }}
      >
        {/* Drag handle */}
        <div
          class="w-full py-1.5 cursor-ns-resize shrink-0 flex items-center justify-center hover:bg-muted/40 transition-colors"
          onMouseDown={handleMouseDown}
        >
          <div class="h-1.5 w-[80px] rounded-full bg-muted" />
        </div>

        {/* Tab bar — compact */}
        <div class="flex shrink-0 items-center justify-between border-b px-2 py-0.5">
          <div class="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overflow-y-hidden scrollbar-none">
            <For each={store.instances()}>
              {(inst) => (
                <div
                  class={cn(
                    "flex h-6 min-w-20 max-w-36 shrink-0 cursor-pointer items-center gap-1 rounded-t-sm px-1.5 text-[11px] transition-colors",
                    store.activeId() === inst.id
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                  onClick={() => store.setActiveId(inst.id)}
                >
                  <span class={cn("iconify size-3 shrink-0", inst.icon || "mdi--terminal")} />
                  <span class="min-w-0 flex-1 truncate">{inst.name}</span>
                  <button
                    type="button"
                    class="flex size-3.5 items-center justify-center rounded-sm hover:bg-muted hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      void closeInstance(inst.id);
                    }}
                  >
                    <span class="iconify mdi--close size-2.5" />
                  </button>
                </div>
              )}
            </For>
          </div>

          <div class="flex shrink-0 items-center gap-0.5 pl-1">
            <div class="flex items-center">
              <Tooltip>
                <TooltipTrigger
                  as={Button}
                  variant="ghost"
                  size="icon"
                  class="size-6 rounded-r-none"
                  onClick={() => void createInstance()}
                >
                  <span class="iconify mdi--plus size-3.5" />
                </TooltipTrigger>
                <TooltipContent>{t("globalTerminal.newTab") as string}</TooltipContent>
              </Tooltip>
              <DropdownMenu>
                <DropdownMenuTrigger
                  as={Button}
                  variant="ghost"
                  size="icon"
                  class="size-6 -ml-px rounded-l-none"
                >
                  <span class="iconify mdi--chevron-down size-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onSelect={() => void createInstance()}>
                    <span class="iconify mdi--terminal mr-2 size-4" />
                    <span>{t("globalTerminal.defaultShell") as string}</span>
                  </DropdownMenuItem>
                  <Show when={shellsQ.data && shellsQ.data.length > 0}>
                    <For each={shellsQ.data}>
                      {(shell) => (
                        <DropdownMenuItem
                          onSelect={() => void createInstance(shell.label, shell.executable)}
                        >
                          <span class="iconify mdi--console mr-2 size-4" />
                          <span>{shell.label}</span>
                        </DropdownMenuItem>
                      )}
                    </For>
                  </Show>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <Tooltip>
              <TooltipTrigger
                as={Button}
                variant="ghost"
                size="icon"
                class="size-6"
                onClick={() => store.setOpen(false)}
              >
                <span class="iconify mdi--close size-3.5" />
              </TooltipTrigger>
              <TooltipContent>{t("common.close") as string}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Terminal content — flexbox matches exact available height and resizes in real time */}
        <div class="min-h-0 flex-1 p-1 flex flex-col">
          <div
            class="relative flex-1 min-h-0 overflow-hidden rounded-sm flex flex-col bg-black/60 backdrop-blur-md"
          >
            <For each={store.instances()}>
              {(inst) => (
                <TerminalHost
                  instance={inst}
                  activeId={store.activeId}
                  isActivePane={store.open()}
                  spawnFn={(shell) => globalTerminalSpawn(undefined, shell)}
                  onSessionId={updateSessionId}
                  onError={(err) => {
                    if (err) toast.error(err);
                  }}
                />
              )}
            </For>
            <Show when={store.instances().length === 0}>
              <div class="flex h-full items-center justify-center text-sm text-muted-foreground flex-1">
                <Button variant="outline" size="sm" onClick={() => void createInstance()}>
                  {t("globalTerminal.newTab") as string}
                </Button>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
