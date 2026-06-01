import { For, Show, createSignal, onMount, onCleanup, createEffect, type Component } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getAppDataDir } from "~/services/tauri/settings";
import { openPath } from "@tauri-apps/plugin-opener";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Badge } from "~/components/ui/badge";
import { useI18n } from "~/lib/i18n-context";

interface PluginCommandMetadata {
  id: string;
  title: string;
  scope: string;
  pluginId: string;
  locales?: any;
}

interface PluginOption {
  id: string;
  label: string;
}

interface PluginInfo {
  id: string;
  name: string;
  description?: string;
  version?: string;
  category?: string;
  enabled: boolean;
  commands: PluginCommandMetadata[];
  locales?: any;
  options?: PluginOption[];
  activeOption?: string;
  config?: any[];
}

interface PluginLog {
  pluginId: string;
  level: "info" | "error";
  message: string;
  timestamp: string;
}

interface PluginsSettingsTabProps {
  t: (key: string) => string;
}

const PluginConfigSection: Component<{
  pluginId: string;
  configSchema: any[];
  t: (key: string) => string;
}> = (props) => {
  const [configValues, setConfigValues] = createSignal<Record<string, any>>({});
  const [errors, setErrors] = createSignal<Record<string, string>>({});
  const [expanded, setExpanded] = createSignal(false);

  onMount(async () => {
    const values: Record<string, any> = {};
    for (const field of props.configSchema) {
      const dbKey = `plugin:${props.pluginId}:${field.key}`;
      try {
        const res = await invoke<string | null>("get_setting", { key: dbKey });
        if (res !== null && res !== "") {
          if (field.type === "boolean") {
            values[field.key] = res === "true";
          } else if (field.type === "number") {
            values[field.key] = Number(res);
          } else {
            values[field.key] = res;
          }
        } else {
          values[field.key] = field.default !== undefined ? field.default : "";
        }
      } catch {
        values[field.key] = field.default !== undefined ? field.default : "";
      }
    }
    setConfigValues(values);
  });

  const validateField = (field: any, val: any): string => {
    if (field.type === "number") {
      const num = Number(val);
      if (isNaN(num)) return "Must be a valid number";
      if (field.validation?.min !== undefined && num < field.validation.min) {
        return `Must be at least ${field.validation.min}`;
      }
      if (field.validation?.max !== undefined && num > field.validation.max) {
        return `Must be at most ${field.validation.max}`;
      }
    }
    if (field.type === "string") {
      const str = String(val);
      if (field.validation?.minLength !== undefined && str.length < field.validation.minLength) {
        return `Must be at least ${field.validation.minLength} characters`;
      }
      if (field.validation?.maxLength !== undefined && str.length > field.validation.maxLength) {
        return `Must be at most ${field.validation.maxLength} characters`;
      }
      if (field.validation?.pattern !== undefined) {
        try {
          const rx = new RegExp(field.validation.pattern);
          if (!rx.test(str)) {
            return `Must match pattern: ${field.validation.pattern}`;
          }
        } catch {
          // ignore invalid regex in validation
        }
      }
    }
    return "";
  };

  const handleChange = async (field: any, rawVal: any) => {
    let val = rawVal;
    if (field.type === "boolean") {
      val = !!rawVal;
    } else if (field.type === "number") {
      val = Number(rawVal);
      if (isNaN(val)) val = rawVal;
    }

    const err = validateField(field, val);
    setErrors(prev => ({ ...prev, [field.key]: err }));
    setConfigValues(prev => ({ ...prev, [field.key]: val }));

    if (err === "") {
      const dbKey = `plugin:${props.pluginId}:${field.key}`;
      const dbVal = String(val);
      try {
        await invoke("set_setting", { key: dbKey, value: dbVal });
        // Re-run init sequence immediately so the plugin can react to the setting change in real-time
        try {
          await invoke("execute_plugin_command", {
            pluginId: props.pluginId,
            commandId: "init",
            context: {},
          });
        } catch (initErr) {
          console.debug(`No custom init sequence for plugin: ${props.pluginId}`, initErr);
        }
      } catch (e) {
        console.error("Failed to save config setting:", e);
      }
    }
  };

  return (
    <div class="border-t border-muted/20 pt-3 mt-1">
      <button
        onClick={() => setExpanded(!expanded())}
        class="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground hover:text-foreground transition-all focus:outline-none"
      >
        <span class="iconify mdi--cog size-3.5" />
        <span>Plugin Settings</span>
        <span
          class="iconify mdi--chevron-right size-3.5 transition-transform duration-200"
          class:rotate-90={expanded()}
        />
      </button>

      <Show when={expanded()}>
        <div class="grid gap-3 mt-3 pl-4 border-l border-muted/20 animate-in slide-in-from-top-1 duration-200">
          <For each={props.configSchema}>
            {(field) => {
              const currentVal = () => configValues()[field.key];
              const currentErr = () => errors()[field.key];

              return (
                <div class="flex flex-col gap-1">
                  <div class="flex items-center justify-between gap-4">
                    <div class="flex flex-col gap-0.5 flex-1">
                      <span class="text-xs font-bold text-foreground/90">{field.label}</span>
                      <Show when={field.description}>
                        <span class="text-[10px] text-muted-foreground leading-normal max-w-sm">{field.description}</span>
                      </Show>
                    </div>

                    <div class="shrink-0 flex items-center">
                      <Show when={field.type === "boolean"}>
                        <Checkbox
                          id={`config-${props.pluginId}-${field.key}`}
                          checked={currentVal() === true}
                          onChange={(checked) => handleChange(field, checked)}
                          class="cursor-pointer"
                        />
                      </Show>

                      <Show when={field.type === "select"}>
                        <select
                          class="bg-background text-xs rounded border border-muted/40 px-2 py-1 focus:outline-none min-w-[120px]"
                          value={currentVal() || ""}
                          onChange={(e) => handleChange(field, e.currentTarget.value)}
                        >
                          <For each={field.options || []}>
                            {(opt) => (
                              <option value={opt.id} selected={opt.id === currentVal()}>
                                {opt.label}
                              </option>
                            )}
                          </For>
                        </select>
                      </Show>

                      <Show when={field.type === "string" || field.type === "number"}>
                        <input
                          type={field.type === "number" ? "number" : "text"}
                          class="bg-background text-xs rounded border border-muted/40 px-2 py-0.5 focus:outline-none w-[120px] text-right"
                          class:border-rose-500={currentErr() !== "" && currentErr() !== undefined}
                          value={currentVal() === undefined ? "" : String(currentVal())}
                          onInput={(e) => handleChange(field, e.currentTarget.value)}
                        />
                      </Show>
                    </div>
                  </div>

                  <Show when={currentErr() !== "" && currentErr() !== undefined}>
                    <span class="text-[9px] font-semibold text-rose-400 pl-0.5 leading-none mt-0.5">
                      {currentErr()}
                    </span>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
};

const PluginCard: Component<{
  plugin: PluginInfo;
  busy: boolean;
  handleToggle: (p: PluginInfo) => Promise<void>;
  getPluginName: (p: PluginInfo) => string;
  getPluginDescription: (p: PluginInfo) => string | undefined;
  getCommandTitle: (cmd: any, p: PluginInfo) => string;
  fetchPlugins: () => Promise<void>;
  t: (key: string) => string;
}> = (props) => {
  const [selectedVal, setSelectedVal] = createSignal(
    props.plugin.activeOption || props.plugin.options?.[0]?.id || ""
  );
  const [applying, setApplying] = createSignal(false);

  createEffect(() => {
    if (props.plugin.activeOption) {
      setSelectedVal(props.plugin.activeOption);
    }
  });

  const handleApply = async () => {
    setApplying(true);
    try {
      await invoke("execute_plugin_command", {
        pluginId: props.plugin.id,
        commandId: "apply_theme",
        context: { flavor: selectedVal() }
      });
      await props.fetchPlugins();
    } catch (err) {
      console.error("Failed to apply theme flavor:", err);
    } finally {
      setApplying(false);
    }
  };

  const handleResetDefault = async () => {
    setApplying(true);
    try {
      await invoke("execute_plugin_command", {
        pluginId: props.plugin.id,
        commandId: "apply_theme",
        context: { flavor: "default" }
      });
      // Instantly remove style tag from document
      const styleId = `plugin-style-${props.plugin.id}`;
      document.getElementById(styleId)?.remove();
      
      await props.fetchPlugins();
    } catch (err) {
      console.error("Failed to reset theme to default:", err);
    } finally {
      setApplying(false);
    }
  };

  const parsedOptions = () => props.plugin.options || [];

  return (
    <div 
      class="flex flex-col gap-3 rounded-lg border border-muted/50 bg-muted/15 p-4 transition-all hover:bg-muted/20"
      class:opacity-60={!props.plugin.enabled}
    >
      <div class="flex items-start justify-between">
        <div class="flex flex-col gap-1 flex-1">
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-foreground">{props.getPluginName(props.plugin)}</span>
            <Show when={props.plugin.version}>
              <Badge variant="outline" class="text-[10px] py-0 px-1.5 font-mono">
                v{props.plugin.version}
              </Badge>
            </Show>
            <Show when={props.plugin.enabled}>
              <span class="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            </Show>
          </div>
          <p class="text-xs text-muted-foreground leading-relaxed mr-4">
            {props.getPluginDescription(props.plugin) ?? "No description provided."}
          </p>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <Checkbox
            id={`toggle-${props.plugin.id}`}
            checked={props.plugin.enabled}
            disabled={props.busy}
            onChange={() => void props.handleToggle(props.plugin)}
            class="cursor-pointer"
          />
        </div>
      </div>

      {/* Select Dropdown & Apply Button for Nested Themes */}
      <Show when={props.plugin.enabled && props.plugin.category === "theme" && parsedOptions().length > 0}>
        <div class="flex flex-wrap items-center gap-2 mt-1 border-t border-muted/30 pt-3 animate-in slide-in-from-top-1 duration-200">
          <select
            class="bg-background text-xs rounded border border-muted/40 px-2 py-1.5 focus:outline-none flex-1 max-w-[200px]"
            value={selectedVal()}
            onChange={(e) => setSelectedVal(e.currentTarget.value)}
          >
            <For each={parsedOptions()}>
              {(opt) => (
                <option value={opt.id} selected={opt.id === selectedVal()}>
                  {opt.label}
                </option>
              )}
            </For>
          </select>
          <Button
            size="sm"
            onClick={() => void handleApply()}
            disabled={applying() || selectedVal() === props.plugin.activeOption}
            class="flex items-center gap-1.5 text-xs px-3 h-8 shrink-0"
          >
            <span class="iconify mdi--check size-4" />
            {props.t("settings.pluginsApplyTheme") ?? "Apply Theme"}
          </Button>

          <Show when={props.plugin.activeOption}>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleResetDefault()}
              disabled={applying()}
              class="flex items-center gap-1.5 text-xs px-3 h-8 shrink-0 text-muted-foreground hover:text-foreground border-muted/50 hover:bg-muted/10"
            >
              <span class="iconify mdi--undo size-4" />
              {props.t("settings.pluginsDefaultTheme") ?? "Default Theme"}
            </Button>
          </Show>
        </div>
      </Show>

      {/* Dynamic Plugin Settings Schema Section */}
      <Show when={props.plugin.enabled && props.plugin.config && props.plugin.config.length > 0}>
        <PluginConfigSection
          pluginId={props.plugin.id}
          configSchema={props.plugin.config || []}
          t={props.t}
        />
      </Show>

      <Show when={props.plugin.commands.length > 0}>
        <div class="border-t border-muted/30 pt-2.5">
          <div class="flex flex-wrap gap-1.5">
            <For each={props.plugin.commands}>
              {(cmd) => (
                <span class="inline-flex items-center gap-1 rounded bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground border border-muted/30">
                  <span class="iconify mdi--flash-outline size-3" />
                  {props.getCommandTitle(cmd, props.plugin)}
                </span>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
};

export const PluginsSettingsTab: Component<PluginsSettingsTabProps> = (props) => {
  const [plugins, setPlugins] = createSignal<PluginInfo[]>([]);
  const [logs, setLogs] = createSignal<PluginLog[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [logFilter, setLogFilter] = createSignal<"all" | "info" | "error">("all");
  const [pluginFilter, setPluginFilter] = createSignal<string>("all");

  let consoleContainerRef: HTMLDivElement | undefined;

  const { locale } = useI18n();

  const getPluginName = (plugin: PluginInfo) => {
    const activeLocale = locale();
    const localMap = plugin.locales?.[activeLocale] || plugin.locales?.["en"];
    return localMap?.["name"] || plugin.name;
  };

  const getPluginDescription = (plugin: PluginInfo) => {
    const activeLocale = locale();
    const localMap = plugin.locales?.[activeLocale] || plugin.locales?.["en"];
    return localMap?.["description"] || plugin.description;
  };

  const getCommandTitle = (cmd: PluginCommandMetadata, plugin: PluginInfo) => {
    const activeLocale = locale();
    const localMap = plugin.locales?.[activeLocale] || plugin.locales?.["en"];
    return localMap?.[`command.${cmd.id}`] || cmd.title;
  };

  const fetchPlugins = async () => {
    try {
      const res = await invoke<PluginInfo[]>("list_plugins");
      setPlugins(res);
    } catch (e) {
      console.error("Failed to list plugins:", e);
    }
  };

  const handleToggle = async (plugin: PluginInfo) => {
    setBusy(true);
    try {
      const nextState = !plugin.enabled;
      await invoke("toggle_plugin", { pluginId: plugin.id, enabled: nextState });
      await fetchPlugins();
    } catch (e) {
      console.error("Failed to toggle plugin:", e);
    } finally {
      setBusy(false);
    }
  };

  const themePlugins = () => plugins().filter((p) => p.category === "theme");
  const extensionPlugins = () => plugins().filter((p) => p.category !== "theme");



  const handleOpenPluginsDir = async () => {
    const r = await getAppDataDir();
    if (r.isErr()) return;
    try {
      await openPath(`${r.value}/plugins`);
    } catch (e) {
      console.error("Failed to open plugins directory:", e);
    }
  };

  onMount(async () => {
    await fetchPlugins();

    const unlistenReload = await listen("plugin:reload", () => {
      void fetchPlugins();
    });

    const unlistenLog = await listen<{ pluginId: string; level: "info" | "error"; message: string }>("plugin:log", (event) => {
      const timestamp = new Date().toLocaleTimeString();
      setLogs((prev) => [
        ...prev,
        {
          pluginId: event.payload.pluginId,
          level: event.payload.level,
          message: event.payload.message,
          timestamp,
        },
      ].slice(-300)); // Keep last 300 logs
    });

    onCleanup(() => {
      unlistenReload();
      unlistenLog();
    });
  });

  // Auto-scroll logic
  createEffect(() => {
    const container = consoleContainerRef;
    if (container && logs().length) {
      container.scrollTop = container.scrollHeight;
    }
  });

  const filteredLogs = () => {
    return logs().filter((log) => {
      const matchesLevel = logFilter() === "all" || log.level === logFilter();
      const matchesPlugin = pluginFilter() === "all" || log.pluginId === pluginFilter();
      return matchesLevel && matchesPlugin;
    });
  };

  return (
    <div class="space-y-8 animate-in fade-in duration-300">
      {/* Tab Header */}
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-sm font-semibold">{props.t("settings.pluginsTitle") ?? "Lua Plugins"}</h3>
          <p class="text-xs text-muted-foreground mt-1">
            {props.t("settings.pluginsDescription") ?? "Extend app functionalities and styling with custom Lua scripts."}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleOpenPluginsDir()}
          class="flex items-center gap-1.5"
        >
          <span class="iconify mdi--folder-outline size-4" />
          {props.t("settings.pluginsOpenFolder") ?? "Open Plugins Folder"}
        </Button>
      </div>

      {/* Installed Plugins List */}
      <div class="space-y-6">
        <h4 class="text-xs font-bold text-muted-foreground uppercase tracking-widest">{props.t("settings.pluginsInstalledTitle") ?? "Installed Plugins"}</h4>
        
        <Show
          when={plugins().length > 0}
          fallback={
            <div class="flex flex-col items-center justify-center rounded-lg border border-dashed border-muted/50 p-8 text-center bg-muted/5">
              <span class="iconify mdi--toy-brick-outline size-10 text-muted-foreground/60 mb-2" />
              <p class="text-xs text-muted-foreground font-medium">{props.t("settings.pluginsNoPlugins") ?? "No plugins installed yet."}</p>
              <p class="text-[10px] text-muted-foreground/80 mt-1 max-w-xs">
                {props.t("settings.pluginsCreateFirst") ?? "Create a folder inside the plugins directory with an init.luau to build your first command!"}
              </p>
            </div>
          }
        >
          <div class="space-y-6">
            {/* Themes Section */}
            <Show when={themePlugins().length > 0}>
              <div class="space-y-3">
                <div class="flex items-center gap-2 border-b border-muted/20 pb-1.5">
                  <span class="iconify mdi--palette-swatch-outline size-4 text-primary" />
                  <span class="text-xs font-semibold text-foreground/90 uppercase tracking-wider">
                    {props.t("settings.pluginsThemesTitle") ?? "Themes"}
                  </span>
                  <span class="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary font-mono leading-none">
                    {themePlugins().length}
                  </span>
                </div>
                <div class="grid gap-3">
                  <For each={themePlugins()}>
                    {(plugin) => (
                      <PluginCard
                        plugin={plugin}
                        busy={busy()}
                        handleToggle={handleToggle}
                        getPluginName={getPluginName}
                        getPluginDescription={getPluginDescription}
                        getCommandTitle={getCommandTitle}
                        fetchPlugins={fetchPlugins}
                        t={props.t}
                      />
                    )}
                  </For>
                </div>
              </div>
            </Show>

            {/* Functional Extensions Section */}
            <Show when={extensionPlugins().length > 0}>
              <div class="space-y-3">
                <div class="flex items-center gap-2 border-b border-muted/20 pb-1.5">
                  <span class="iconify mdi--toy-brick-outline size-4 text-primary" />
                  <span class="text-xs font-semibold text-foreground/90 uppercase tracking-wider">
                    {props.t("settings.pluginsExtensionsTitle") ?? "Functional Extensions"}
                  </span>
                  <span class="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary font-mono leading-none">
                    {extensionPlugins().length}
                  </span>
                </div>
                <div class="grid gap-3">
                  <For each={extensionPlugins()}>
                    {(plugin) => (
                      <PluginCard
                        plugin={plugin}
                        busy={busy()}
                        handleToggle={handleToggle}
                        getPluginName={getPluginName}
                        getPluginDescription={getPluginDescription}
                        getCommandTitle={getCommandTitle}
                        fetchPlugins={fetchPlugins}
                        t={props.t}
                      />
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </div>
        </Show>
      </div>

      {/* Real-time Log Console */}
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <h4 class="text-xs font-bold text-muted-foreground uppercase tracking-widest">{props.t("settings.pluginsConsoleTitle") ?? "Real-time Log Console"}</h4>
          
          <div class="flex items-center gap-2">
            {/* Level filters */}
            <div class="flex items-center rounded border bg-muted/20 p-0.5">
              <button
                class="px-2 py-0.5 text-[10px] font-medium rounded transition-all"
                class:bg-background={logFilter() === "all"}
                class:shadow-sm={logFilter() === "all"}
                onClick={() => setLogFilter("all")}
              >
                {props.t("settings.pluginsFilterAll") ?? "All"}
              </button>
              <button
                class="px-2 py-0.5 text-[10px] font-medium rounded transition-all"
                class:bg-background={logFilter() === "info"}
                class:shadow-sm={logFilter() === "info"}
                class:text-emerald-400={logFilter() === "info"}
                onClick={() => setLogFilter("info")}
              >
                {props.t("settings.pluginsFilterInfo") ?? "Info"}
              </button>
              <button
                class="px-2 py-0.5 text-[10px] font-medium rounded transition-all"
                class:bg-background={logFilter() === "error"}
                class:shadow-sm={logFilter() === "error"}
                class:text-rose-400={logFilter() === "error"}
                onClick={() => setLogFilter("error")}
              >
                {props.t("settings.pluginsFilterError") ?? "Error"}
              </button>
            </div>

            {/* Plugin selector */}
            <Show when={plugins().length > 0}>
              <select
                class="bg-background text-[10px] font-medium rounded border border-muted/40 px-2 py-0.5 focus:outline-none"
                value={pluginFilter()}
                onChange={(e) => setPluginFilter(e.currentTarget.value)}
              >
                <option value="all">{props.t("settings.pluginsAllPlugins") ?? "All Plugins"}</option>
                <For each={plugins()}>
                  {(plugin) => (
                    <option value={plugin.id}>{plugin.name}</option>
                  )}
                </For>
              </select>
            </Show>

            {/* Clear button */}
            <Button
              variant="ghost"
              size="icon"
              class="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={() => setLogs([])}
              title={props.t("settings.pluginsClearConsole") ?? "Clear Console"}
            >
              <span class="iconify mdi--trash-can-outline size-4" />
            </Button>
          </div>
        </div>

        {/* Terminal logs container */}
        <div 
          ref={consoleContainerRef}
          class="h-56 rounded-lg border border-muted/50 bg-[#07090e] p-3 font-mono text-xs overflow-y-auto scrollbar-thin select-text flex flex-col gap-1.5"
        >
          <Show
            when={filteredLogs().length > 0}
            fallback={
              <div class="flex h-full flex-col items-center justify-center text-muted-foreground/40 font-sans">
                <span class="iconify mdi--console size-8 mb-1" />
                <span class="text-[10px] font-semibold tracking-wide uppercase">{props.t("settings.pluginsConsoleEmpty") ?? "Console is empty"}</span>
              </div>
            }
          >
            <For each={filteredLogs()}>
              {(log) => (
                <div class="flex items-start gap-2 border-b border-white/[0.02] pb-1 last:border-0 leading-relaxed">
                  <span class="text-[10px] text-muted-foreground/60 shrink-0 select-none">
                    [{log.timestamp}]
                  </span>
                  <span class="text-[10px] text-sky-400/90 font-bold shrink-0 uppercase tracking-wider">
                    {log.pluginId}
                  </span>
                  <span 
                    class="text-[10px] font-extrabold shrink-0 select-none"
                    class:text-emerald-500={log.level === "info"}
                    class:text-rose-500={log.level === "error"}
                  >
                    [{log.level.toUpperCase()}]
                  </span>
                  <span 
                    class="break-all whitespace-pre-wrap flex-1"
                    class:text-slate-100={log.level === "info"}
                    class:text-rose-300={log.level === "error"}
                  >
                    {log.message}
                  </span>
                </div>
              )}
            </For>
          </Show>
        </div>
      </div>
    </div>
  );
};
