import { createQuery } from "@tanstack/solid-query";
import {
  For,
  Show,
  type Accessor,
} from "solid-js";
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
import { embeddedTerminalSpawn, listAvailableShells } from "~/services/tauri/terminal";
import { getSetting } from "~/services/tauri/settings";
import { TerminalHost, type TerminalHostInstance } from "~/components/terminal/TerminalHost";

export type EmbeddedTerminalInstance = TerminalHostInstance;

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

export function EmbeddedTerminalPane(props: {
  projectId: string;
  active: boolean;
  instances: Accessor<readonly EmbeddedTerminalInstance[]>;
  activeId: Accessor<string | null>;
  finishedCount: Accessor<number>;
  onOpenTerminal: (instance: Pick<EmbeddedTerminalInstance, "name" | "defaultName" | "shell" | "icon">) => void;
  onCloseTerminal: (id: string) => void | Promise<void>;
  onCloseFinishedTerminals: () => void;
  onSelectTerminal: (id: string) => void;
  onUpdateSessionId: (id: string, sessionId: string) => void;
  onUpdateName?: (id: string, command: string) => void;
  onExternalShell?: () => void;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
}) {
  const { t } = useI18n();

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
    const shellInfo = shellsQ.data?.find(s => s.executable === targetShell);
    const label = name || shellInfo?.label || (targetShell ? (t("projectDetail.tabTerminal") as string) : (t("projectDetail.terminalDefaultShell") as string));
    const icon = shellInfo ? (SHELL_ICON_MAP[shellInfo.id.toLowerCase()] || "mdi--console") : "mdi--terminal";

    props.onOpenTerminal({
      name: label,
      defaultName: label,
      shell: targetShell,
      icon,
    });
  };

  const closeInstance = (id: string) => {
    void props.onCloseTerminal(id);
  };

  const updateInstanceName = (id: string, command: string) => {
    props.onUpdateName?.(id, command);
  };

  return (
    <div
      class={cn(
        "flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-card",
        props.fullscreen && "fixed inset-x-0 bottom-0 top-9 z-50 rounded-none border-0",
      )}
    >
      <div class="flex shrink-0 items-center justify-between px-3 pt-2 pb-1.5">
        <div class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden scrollbar-none">
          <For each={props.instances()}>
            {(inst) => (
              <div
                class={cn(
                  "flex h-7 min-w-24 max-w-40 shrink-0 cursor-pointer items-center gap-1.5 rounded-t-sm px-2 text-xs transition-colors",
                  props.activeId() === inst.id
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
                onClick={() => props.onSelectTerminal(inst.id)}
              >
                <span class={cn("iconify size-3.5 shrink-0", inst.icon || "mdi--terminal")} />
                <span class="min-w-0 flex-1 truncate">{inst.name}</span>
                <button
                  type="button"
                  class="flex size-4 items-center justify-center rounded-sm hover:bg-muted hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeInstance(inst.id);
                  }}
                >
                  <span class="iconify mdi--close size-3" />
                </button>
              </div>
            )}
          </For>
        </div>

        <div class="flex shrink-0 items-center gap-1 pl-2">
          <div class="flex items-center">
            <Tooltip>
              <TooltipTrigger as={Button}
                variant="ghost"
                size="icon"
                class="size-7 rounded-r-none"
                onClick={() => void createInstance()}
              >
                <span class="iconify mdi--plus size-4" />
              </TooltipTrigger>
              <TooltipContent>{t("projectDetail.terminalNew") as string}</TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger
                as={Button}
                variant="ghost"
                size="icon"
                class="size-7 -ml-px rounded-l-none"
              >
                <span class="iconify mdi--chevron-down size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => void createInstance()}>
                  <span class="iconify mdi--terminal mr-2 size-4" />
                  <span>{t("projectDetail.terminalDefaultShell") as string}</span>
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

          <Show when={props.finishedCount() > 0}>
            <Tooltip>
              <TooltipTrigger
                as={Button}
                type="button"
                variant="ghost"
                size="icon"
                class="size-7"
                onClick={() => props.onCloseFinishedTerminals()}
              >
                <span class="iconify mdi--broom size-4" />
              </TooltipTrigger>
              <TooltipContent>{t("projectDetail.closeFinishedTabs") as string}</TooltipContent>
            </Tooltip>
          </Show>

          <Show when={props.onToggleFullscreen}>
            <Tooltip>
              <TooltipTrigger
                as={Button}
                type="button"
                variant="ghost"
                size="icon"
                class="size-7"
                onClick={() => props.onToggleFullscreen?.()}
              >
                <span class={cn("iconify size-4", props.fullscreen ? "mdi--fullscreen-exit" : "mdi--fullscreen")} />
              </TooltipTrigger>
              <TooltipContent>{props.fullscreen ? "Exit Fullscreen" : "Fullscreen Terminal"}</TooltipContent>
            </Tooltip>
          </Show>

          <Show when={props.onExternalShell}>
            <Tooltip>
              <TooltipTrigger
                as={Button}
                type="button"
                variant="ghost"
                size="icon"
                class="size-7"
                onClick={() => props.onExternalShell?.()}
              >
                <span class="iconify mdi--open-in-new size-4" />
              </TooltipTrigger>
              <TooltipContent>{t("projectDetail.openExternalTerminal") as string}</TooltipContent>
            </Tooltip>
          </Show>
        </div>
      </div>

      <div class="min-h-0 flex-1 p-3 flex flex-col">
        <div class="relative flex-1 min-h-0 overflow-hidden rounded-sm flex flex-col" style={{ "background-color": "#111111" }}>
          <For each={props.instances()}>
            {(inst) => (
              <TerminalHost
                instance={inst}
                activeId={props.activeId}
                isActivePane={props.active}
                spawnFn={(shell) => embeddedTerminalSpawn(props.projectId, shell)}
                onSessionId={(id, sid) => props.onUpdateSessionId(id, sid)}
                onError={(err) => toast.error(err)}
                  onProcessExit={(id, hasContent) => {
                    if (!hasContent) {
                      void props.onCloseTerminal(id);
                    }
                  }}
                  onCommandEntered={updateInstanceName}
                />
            )}
          </For>
          <Show when={props.instances().length === 0}>
            <div class="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Button variant="outline" size="sm" onClick={() => void createInstance()}>
                {(t("projectDetail.openTerminal") as string)}
              </Button>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}


