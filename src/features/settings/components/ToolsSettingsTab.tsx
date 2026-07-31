import { Show, For, createMemo, type Component } from "solid-js";
import { Select } from "~/components/ui/select";
import { TabsContent } from "~/components/ui/tabs";
import { TextField, TextFieldInput } from "~/components/ui/text-field";
import { cn } from "~/lib/utils";

export type ToolsSettingsTabProps = Readonly<{
  t: (key: string) => string;
  busy: boolean;
  idesQ: { isLoading: boolean; data?: any[] };
  shellsQ: { isLoading: boolean; data?: any[] };
  toolsQ: { isLoading: boolean; data?: any[] };
  defaultIde: string;
  setDefaultIde: (v: string) => void;
  defaultShell: string;
  setDefaultShell: (v: string) => void;
  shellPath: string;
  setShellPath: (v: string) => void;
}>;

type IdeOption = { value: string; label: string; textValue: string; icon?: string | null; iconData?: string | null };
type ShellOption = { value: string; label: string; textValue: string; icon?: string | null };

const SHELL_ICON_MAP: Record<string, string> = {
  "powershell": "mdi--powershell",
  "pwsh": "mdi--powershell",
  "cmd": "mdi--console",
  "nu": "mdi--nix",
  "bash": "mdi--bash",
  "zsh": "mdi--bash",
  "fish": "mdi--fish",
  "sh": "mdi--console-line",
};

export const ToolsSettingsTab: Component<ToolsSettingsTabProps> = (props) => {
  const ideOptions = createMemo((): IdeOption[] => {
    const data = props.idesQ.data;
    if (!data) return [];
    return data.map((i) => ({
      value: i.executable,
      label: i.label,
      textValue: i.label,
      icon: i.icon,
      iconData: i.iconData,
    }));
  });

  const selectedIde = createMemo(() => ideOptions().find((o) => o.value === props.defaultIde) ?? null);

  const shellOptions = createMemo((): ShellOption[] => {
    const data = props.shellsQ.data;
    if (!data) return [];
    return data.map((s) => ({
      value: s.executable,
      label: s.label,
      textValue: s.label,
      icon: SHELL_ICON_MAP[s.id.toLowerCase()] || "mdi--console",
    }));
  });

  const selectedShell = createMemo(
    () => shellOptions().find((o) => o.value === props.defaultShell) ?? null,
  );

  return (
    <TabsContent value="tools" class="space-y-8 outline-none animate-in fade-in duration-300">
      <section class="space-y-4">
        <div class="space-y-1">
          <h3 class="text-sm font-bold uppercase tracking-wider text-primary/80">{props.t("settings.externalAppsTitle")}</h3>
          <p class="text-xs text-muted-foreground">
            {props.t("settings.externalAppsDescription")}
          </p>
        </div>
        <div class="grid gap-6">
          <div class="grid gap-2">
            <label class="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              {props.t("settings.defaultIde")}
            </label>
            <Select<IdeOption>
              options={ideOptions()}
              optionValue="value"
              optionTextValue="textValue"
              value={selectedIde()}
              onChange={(o) => o && props.setDefaultIde(String(o.value))}
              disabled={props.busy || props.idesQ.isLoading}
              itemComponent={(p) => (
                <Select.Item item={p.item}>
                  <div class="flex items-center gap-2">
                      <Show
                        when={p.item.rawValue.iconData}
                        fallback={
                          <Show when={p.item.rawValue.icon}>
                            <span class={cn("iconify shrink-0 size-4", p.item.rawValue.icon!)} />
                          </Show>
                        }
                      >
                        {(src) => <img src={src()} alt="" class="size-4 shrink-0 object-contain" />}
                      </Show>
                      <Select.ItemLabel>{p.item.rawValue.label}</Select.ItemLabel>
                  </div>
                </Select.Item>
              )}
            >
              <Select.Trigger class="bg-muted/30 h-10">
                <Select.Value<IdeOption>>
                  {(s) => (
                    <div class="flex items-center gap-2 truncate">
                      <Show
                        when={s.selectedOption()?.iconData}
                        fallback={
                          <Show when={s.selectedOption()?.icon}>
                            {(icon) => <span class={cn("iconify shrink-0 size-4", icon())} />}
                          </Show>
                        }
                      >
                        {(src) => <img src={src()} alt="" class="size-4 shrink-0 object-contain" />}
                      </Show>
                      <span class="truncate">
                        {s.selectedOption()?.label ?? props.t("settings.defaultIdePlaceholder")}
                      </span>
                    </div>
                  )}
                </Select.Value>
                <span class="iconify mdi--chevron-down h-4 w-4 opacity-50" />
              </Select.Trigger>
              <Select.Content>
                  <Select.Listbox />
              </Select.Content>
            </Select>
          </div>

          <div class="grid gap-2">
            <label class="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              {props.t("settings.defaultShell")}
            </label>
            <Select<ShellOption>
              options={shellOptions()}
              optionValue="value"
              optionTextValue="textValue"
              value={selectedShell()}
              onChange={(o) => o && props.setDefaultShell(String(o.value))}
              disabled={props.busy || props.shellsQ.isLoading}
              itemComponent={(p) => (
                <Select.Item item={p.item}>
                  <div class="flex items-center gap-2">
                      <Show when={p.item.rawValue.icon}>
                          <span class={cn("iconify shrink-0 size-4", p.item.rawValue.icon!)} />
                      </Show>
                      <Select.ItemLabel>{p.item.rawValue.label}</Select.ItemLabel>
                  </div>
                </Select.Item>
              )}
            >
              <Select.Trigger class="bg-muted/30 h-10">
                <Select.Value<ShellOption>>
                  {(s) => (
                      <div class="flex items-center gap-2 truncate">
                          <Show when={s.selectedOption()?.icon}>
                              {(icon) => <span class={cn("iconify shrink-0 size-4", icon())} />}
                          </Show>
                          <span class="truncate">
                              {s.selectedOption()?.label ?? props.t("settings.defaultShellPlaceholder")}
                          </span>
                      </div>
                  )}
                </Select.Value>
                <span class="iconify mdi--chevron-down h-4 w-4 opacity-50" />
              </Select.Trigger>
              <Select.Content>
                  <Select.Listbox />
              </Select.Content>
            </Select>
          </div>

          <div class="grid gap-2">
            <label class="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              {props.t("settings.customShellPath")}
            </label>
            <TextField>
              <TextFieldInput
                class="bg-muted/30"
                placeholder={props.t("settings.shellPlaceholder")}
                value={props.shellPath}
                onInput={(e) => props.setShellPath(e.currentTarget.value)}
                disabled={props.busy}
                autocomplete="off"
              />
            </TextField>
            <p class="text-[10px] text-muted-foreground italic leading-tight px-1">
              {props.t("settings.customShellPathDescription")}
            </p>
          </div>
        </div>
      </section>

      <section class="space-y-4">
        <div class="space-y-1">
          <h3 class="text-sm font-bold uppercase tracking-wider text-primary/80">{props.t("settings.systemToolsTitle")}</h3>
          <p class="text-xs text-muted-foreground">
            {props.t("settings.systemToolsDescription")}
          </p>
        </div>
        <Show when={props.toolsQ.isLoading}>
          <p class="text-xs text-muted-foreground">{props.t("settings.systemToolsScanning")}</p>
        </Show>
        <Show when={props.toolsQ.data && props.toolsQ.data.length > 0}>
          <div class="grid gap-2">
            <For each={props.toolsQ.data}>
              {(tool) => (
                <div class={cn(
                  "flex items-center gap-3 rounded-md border px-3 py-2",
                  tool.available
                    ? "border-border/40 bg-muted/20"
                    : "border-border/20 bg-muted/5 opacity-60"
                )}>
                  <span class={cn("iconify shrink-0 size-5",
                    tool.id === "mise" ? "mdi--cube-outline" :
                    tool.id === "git" ? "mdi--git" :
                    tool.id === "portless" ? "mdi--lan" :
                    "mdi--file-document-edit-outline"
                  )} />
                  <div class="min-w-0 flex-1">
                    <p class="text-xs font-bold truncate">{tool.label}</p>
                    <p class="text-[10px] text-muted-foreground font-mono truncate">
                      {tool.available ? tool.executable : tool.id}
                    </p>
                  </div>
                  <Show when={tool.available && tool.version}>
                    <span class="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">{tool.version}</span>
                  </Show>
                  <Show when={!tool.available}>
                    <span class="text-[10px] text-destructive/80 bg-destructive/10 px-1.5 py-0.5 rounded">{props.t("settings.systemToolsNotDetected")}</span>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </section>
    </TabsContent>
  );
};
