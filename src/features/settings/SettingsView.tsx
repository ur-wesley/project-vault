import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { isTauri } from "@tauri-apps/api/core";

import { Button } from "~/components/ui/button";
import { Select } from "~/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { TextField, TextFieldInput } from "~/components/ui/text-field";
import { useI18n } from "~/lib/i18n-context";
import { stableErrorMessage } from "~/lib/invoke-error";
import { GITHUB_TOKEN_SETTING_KEY, fetchGitHubViewer } from "~/services/github";
import { runGithubDeviceSignIn } from "~/services/github-device-signin";
import { queryKeys } from "~/services/query-keys";
import {
  exportLibrarySnapshot,
  getSetting,
  isGithubDeviceConfigured,
  listAvailableShells,
  listDiscoveredIdes,
  setSetting,
} from "~/services/tauri";
import { cn } from "~/lib/utils";
import { LocationManager } from "../locations";

const SHELL_KEY = "shell_path";
const SCAN_KEY = "scan_interval_minutes";
const DEFAULT_IDE_KEY = "default_ide_path";
const DEFAULT_SHELL_KEY = "default_shell_path";

type IdeOption = { value: string; label: string; textValue: string; icon?: string | null };
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

export function SettingsView(props: {
  activeTab: string;
  onTabChange: (v: string) => void;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [shellPath, setShellPath] = createSignal("");
  const [scanMinutes, setScanMinutes] = createSignal("0");
  const [defaultIde, setDefaultIde] = createSignal("");
  const [defaultShell, setDefaultShell] = createSignal("");

  const densityOptions = createMemo(() => [
    {
      value: "comfortable",
      label: t("settings.densityComfortable") as string,
      textValue: "comfortable",
    },
    { value: "compact", label: t("settings.densityCompact") as string, textValue: "compact" },
  ]);

  const idesQ = createQuery(() => ({
    queryKey: queryKeys.discoveredIdes,
    queryFn: async () => {
      const r = await listDiscoveredIdes();
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

  const shellsQ = createQuery(() => ({
    queryKey: queryKeys.availableShells,
    queryFn: async () => {
      const r = await listAvailableShells();
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

  const ghViewerQ = createQuery(() => ({
    queryKey: queryKeys.githubViewer(),
    queryFn: async () => {
      if (!isTauri()) return null;
      const r = await fetchGitHubViewer();
      if (r.isErr()) return null;
      return r.value;
    },
  }));

  const ideOptions = createMemo((): IdeOption[] => {
    const data = idesQ.data;
    if (!data) return [];
    return data.map((i) => ({
      value: i.executable,
      label: i.label,
      textValue: i.label,
      icon: i.icon,
    }));
  });

  const selectedIde = createMemo(() => ideOptions().find((o) => o.value === defaultIde()) ?? null);

  const shellOptions = createMemo((): ShellOption[] => {
    const data = shellsQ.data;
    if (!data) return [];
    return data.map((s) => ({
      value: s.executable,
      label: s.label,
      textValue: s.label,
      icon: SHELL_ICON_MAP[s.id.toLowerCase()] || "mdi--console",
    }));
  });

  const selectedShell = createMemo(
    () => shellOptions().find((o) => o.value === defaultShell()) ?? null,
  );

  const [githubToken, setGithubToken] = createSignal("");
  const [githubUserCode, setGithubUserCode] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [banner, setBanner] = createSignal<string | null>(null);

  const settingsQ = createQuery(() => ({
    queryKey: ["settings", "view"] as const,
    queryFn: async () => {
      const [sh, scan, gh, di, ds] = await Promise.all([
        getSetting(SHELL_KEY),
        getSetting(SCAN_KEY),
        getSetting(GITHUB_TOKEN_SETTING_KEY),
        getSetting(DEFAULT_IDE_KEY),
        getSetting(DEFAULT_SHELL_KEY),
      ]);
      if (sh.isErr()) throw new Error(sh.error.message);
      if (scan.isErr()) throw new Error(scan.error.message);
      if (gh.isErr()) throw new Error(gh.error.message);
      if (di.isErr()) throw new Error(di.error.message);
      if (ds.isErr()) throw new Error(ds.error.message);

      return {
        shell: sh.value ?? "",
        scan: scan.value ?? "0",
        githubToken: gh.value ?? "",
        defaultIde: di.value ?? "",
        defaultShell: ds.value ?? "",
      };
    },
  }));

  const ghDeviceReadyQ = createQuery(() => ({
    queryKey: ["settings", "github", "device", "ready"] as const,
    queryFn: async () => {
      if (!isTauri()) return false;
      const envId = import.meta.env.VITE_GITHUB_DEVICE_CLIENT_ID;
      const r = await isGithubDeviceConfigured(envId);
      if (r.isErr()) return false;
      return r.value;
    },
  }));

  createEffect(() => {
    if (settingsQ.isSuccess && settingsQ.data) {
      const d = settingsQ.data;
      setShellPath(d.shell);
      setScanMinutes(d.scan);
      setGithubToken(d.githubToken);
      setDefaultIde(d.defaultIde);
      setDefaultShell(d.defaultShell);
    }
  });

  const onGithubDeviceSignIn = async () => {
    if (!isTauri()) return;
    setBusy(true);
    setBanner(null);
    setGithubUserCode("");
    try {
      setBanner(t("settings.githubDeviceWaiting") as string);
      const envId = import.meta.env.VITE_GITHUB_DEVICE_CLIENT_ID;
      const r = await runGithubDeviceSignIn({
        clientId: envId,
        onUserCode: (code) => {
          setGithubUserCode(code);
        },
      });
      if (r !== "ok") {
        setBanner(stableErrorMessage(t, r));
        return;
      }
      setGithubUserCode("");
      const tokR = await getSetting(GITHUB_TOKEN_SETTING_KEY);
      if (tokR.isOk() && tokR.value != null) {
        setGithubToken(tokR.value);
      }
      void settingsQ.refetch();
      void ghViewerQ.refetch();
      void qc.invalidateQueries({ queryKey: queryKeys.githubViewer() });
      void qc.invalidateQueries({
        predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "github",
      });
      setBanner(t("settings.githubDeviceSuccess") as string);
    } finally {
      setBusy(false);
    }
  };

  const onSave = async () => {
    setBusy(true);
    setBanner(null);
    try {
      for (const [key, val] of [
        [SHELL_KEY, shellPath()],
        [SCAN_KEY, scanMinutes().trim() || "0"],
        [GITHUB_TOKEN_SETTING_KEY, githubToken()],
        [DEFAULT_IDE_KEY, defaultIde()],
        [DEFAULT_SHELL_KEY, defaultShell()],
      ] as const) {
        const r = await setSetting(key, val);
        if (r.isErr()) {
          setBanner(stableErrorMessage(t, r.error));
          return;
        }
      }
      void settingsQ.refetch();
      void qc.invalidateQueries({
        predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "settings",
      });
      void qc.invalidateQueries({
        predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "github",
      });
      setBanner(t("settings.saved") as string);
    } finally {
      setBusy(false);
    }
  };

  const onExport = async () => {
    setBusy(true);
    setBanner(null);
    try {
      const r = await exportLibrarySnapshot();
      if (r.isErr()) {
        setBanner(stableErrorMessage(t, r.error));
        return;
      }
      const blob = new Blob([JSON.stringify(r.value, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `project-vault-export-${r.value.exportedAtMs}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="flex h-full flex-col overflow-hidden bg-background font-sans">
      <header class="flex h-14 shrink-0 items-center gap-4 border-b px-6">
        <Button variant="ghost" size="icon" onClick={() => props.onBack()} class="h-8 w-8">
          <span class="iconify mdi--arrow-left h-4 w-4" />
        </Button>
        <h2 class="text-lg font-bold tracking-tight">{t("settings.title") as string}</h2>
      </header>

      <div class="flex-1 overflow-hidden px-6 py-6">
        <div class="mx-auto max-w-2xl h-full flex flex-col gap-6">
          <Tabs
            value={props.activeTab}
            onChange={props.onTabChange}
            class="flex flex-1 flex-col overflow-hidden"
          >
            <TabsList class="mb-6 w-full flex bg-muted/40 p-1">
              <TabsTrigger value="general" class="flex-1 font-semibold text-xs uppercase tracking-wider">General</TabsTrigger>
              <TabsTrigger value="locations" class="flex-1 font-semibold text-xs uppercase tracking-wider">Locations</TabsTrigger>
              <TabsTrigger value="tools" class="flex-1 font-semibold text-xs uppercase tracking-wider">Tools</TabsTrigger>
              <TabsTrigger value="accounts" class="flex-1 font-semibold text-xs uppercase tracking-wider">Accounts</TabsTrigger>
            </TabsList>

            <Show when={banner() != null && (banner() as string).length > 0}>
              <div class="mb-6 rounded-md bg-muted p-3 text-sm text-muted-foreground border border-border/50 animate-in fade-in slide-in-from-top-1">
                {banner()}
              </div>
            </Show>

            <div class="flex-1 overflow-y-auto px-1 pr-2 scrollbar-none">
              <TabsContent value="general" class="space-y-8 outline-none animate-in fade-in duration-300">
                <section class="space-y-4">
                  <div class="space-y-1">
                    <h3 class="text-sm font-bold uppercase tracking-wider text-primary/80">Interface</h3>
                    <p class="text-xs text-muted-foreground">
                      Configure the background scan rhythm of the application.
                    </p>
                  </div>
                  <div class="grid gap-6 max-w-sm">
                    <div class="grid gap-2">
                      <label class="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                        {t("settings.scanInterval") as string}
                      </label>
                      <TextField>
                        <TextFieldInput
                          type="number"
                          min={0}
                          class="bg-muted/30"
                          value={scanMinutes()}
                          onInput={(e) => setScanMinutes(e.currentTarget.value)}
                          disabled={busy()}
                          autocomplete="off"
                        />
                      </TextField>
                    </div>
                  </div>
                </section>

                <section class="space-y-4">
                  <div class="space-y-1">
                    <h3 class="text-sm font-bold uppercase tracking-wider text-primary/80">Data</h3>
                    <p class="text-xs text-muted-foreground">
                      Manage your project vault data and portability.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    class="w-full sm:w-auto bg-muted/20 border-border/60"
                    disabled={busy()}
                    onClick={() => void onExport()}
                  >
                    <span class="iconify mdi--download mr-2 h-4 w-4" />
                    {t("settings.export") as string}
                  </Button>
                </section>
              </TabsContent>

              <TabsContent value="locations" class="outline-none animate-in fade-in duration-300">
                  <LocationManager />
              </TabsContent>

              <TabsContent value="tools" class="space-y-8 outline-none animate-in fade-in duration-300">
                <section class="space-y-4">
                  <div class="space-y-1">
                    <h3 class="text-sm font-bold uppercase tracking-wider text-primary/80">External Applications</h3>
                    <p class="text-xs text-muted-foreground">
                      Configure your preferred IDE and shell for opening projects.
                    </p>
                  </div>
                  <div class="grid gap-6 max-w-sm">
                    <div class="grid gap-2">
                      <label class="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                        {t("settings.defaultIde") as string}
                      </label>
                      <Select<IdeOption>
                        options={ideOptions()}
                        optionValue="value"
                        optionTextValue="textValue"
                        value={selectedIde()}
                        onChange={(o) => o && setDefaultIde(String(o.value))}
                        disabled={busy() || idesQ.isLoading}
                        itemComponent={(p) => (
                          <Select.Item item={p.item}>
                            <div class="flex items-center gap-2">
                                <Show when={p.item.rawValue.icon}>
                                  <span class={cn("iconify shrink-0 size-4", p.item.rawValue.icon)} />
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
                                <Show when={s.selectedOption()?.icon}>
                                  <span class={cn("iconify shrink-0 size-4", s.selectedOption()?.icon)} />
                                </Show>
                                <span class="truncate">
                                  {s.selectedOption()?.label ?? (t("settings.defaultIdePlaceholder") as string)}
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
                        Default shell
                      </label>
                      <Select<ShellOption>
                        options={shellOptions()}
                        optionValue="value"
                        optionTextValue="textValue"
                        value={selectedShell()}
                        onChange={(o) => o && setDefaultShell(String(o.value))}
                        disabled={busy() || shellsQ.isLoading}
                        itemComponent={(p) => (
                          <Select.Item item={p.item}>
                            <div class="flex items-center gap-2">
                                <Show when={p.item.rawValue.icon}>
                                    <span class={cn("iconify shrink-0 size-4", p.item.rawValue.icon)} />
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
                                        <span class={cn("iconify shrink-0 size-4", s.selectedOption()?.icon)} />
                                    </Show>
                                    <span class="truncate">
                                        {s.selectedOption()?.label ?? "Choose a default shell"}
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
                        Custom Shell Path
                      </label>
                      <TextField>
                        <TextFieldInput
                          class="bg-muted/30"
                          placeholder={t("settings.shellPlaceholder") as string}
                          value={shellPath()}
                          onInput={(e) => setShellPath(e.currentTarget.value)}
                          disabled={busy()}
                          autocomplete="off"
                        />
                      </TextField>
                      <p class="text-[10px] text-muted-foreground italic leading-tight px-1">
                        Override the detected shells by providing an absolute path to an executable.
                      </p>
                    </div>
                  </div>
                </section>
              </TabsContent>

              <TabsContent value="accounts" class="space-y-8 outline-none animate-in fade-in duration-300">
                <section class="space-y-4">
                  <div class="space-y-1">
                    <h3 class="text-sm font-bold uppercase tracking-wider text-primary/80">GitHub</h3>
                    <p class="text-xs text-muted-foreground">
                      Manage your GitHub connection and API tokens.
                    </p>
                  </div>

                  <div class="grid gap-6 max-w-sm">
                    <div class="flex flex-col gap-3">
                      <div class="flex flex-wrap items-center gap-3">
                        <Show when={ghViewerQ.data} fallback={
                            <Button
                                type="button"
                                variant="secondary"
                                class="w-full bg-muted/40 h-10"
                                disabled={
                                    busy() ||
                                    !isTauri() ||
                                    ghDeviceReadyQ.isLoading ||
                                    ghDeviceReadyQ.isError ||
                                    (ghDeviceReadyQ.isSuccess && !ghDeviceReadyQ.data)
                                }
                                onClick={() => void onGithubDeviceSignIn()}
                            >
                                <span class="iconify mdi--github mr-2 h-4 w-4" />
                                {t("settings.githubSignIn") as string}
                            </Button>
                        }>
                            <div class="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 w-full shadow-sm">
                                <div class="size-12 rounded-full bg-primary/10 flex items-center justify-center border-2 border-background shrink-0 overflow-hidden shadow-sm">
                                    <Show when={ghViewerQ.data!.avatarUrl} fallback={<span class="iconify mdi--account size-7 text-primary/60" />}>
                                        <img src={ghViewerQ.data!.avatarUrl!} alt="Avatar" class="size-full object-cover" />
                                    </Show>
                                </div>
                                <div class="min-w-0 flex-1">
                                    <p class="text-sm font-bold leading-tight truncate">{ghViewerQ.data!.login}</p>
                                    <p class="text-[10px] text-primary/70 uppercase tracking-widest font-black mt-0.5">Authenticated</p>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    class="h-8 text-[10px] font-bold uppercase tracking-tighter text-muted-foreground hover:text-destructive hover:bg-destructive/5"
                                    onClick={() => {
                                        if (confirm("Sign out from GitHub?")) {
                                            setBusy(true);
                                            setSetting(GITHUB_TOKEN_SETTING_KEY, "").then(() => {
                                                void settingsQ.refetch();
                                                void ghViewerQ.refetch();
                                                setBusy(false);
                                            });
                                        }
                                    }}
                                >
                                    Sign Out
                                </Button>
                            </div>
                        </Show>
                        <Show when={isTauri() && ghDeviceReadyQ.isSuccess && !ghDeviceReadyQ.data}>
                          <p class="text-xs text-destructive/80 font-medium leading-tight p-2 bg-destructive/5 border border-destructive/10 rounded-md">
                            {t("settings.githubDeviceNotConfigured") as string}
                          </p>
                        </Show>
                      </div>

                      <Show when={githubUserCode().length > 0}>
                        <div class="rounded-lg bg-primary/10 p-5 border-2 border-primary/20 space-y-3 shadow-inner animate-pulse">
                          <p class="text-[10px] font-black uppercase tracking-widest text-primary text-center">
                            {t("settings.githubDeviceCodeHint") as string}
                          </p>
                          <p class="font-mono text-3xl font-black tracking-[0.2em] text-foreground text-center">
                            {githubUserCode()}
                          </p>
                        </div>
                      </Show>
                    </div>

                    <div class="grid gap-2 pt-2">
                      <label class="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                        {t("settings.githubToken") as string}
                      </label>
                      <TextField>
                        <TextFieldInput
                          type="password"
                          autocomplete="off"
                          class="bg-muted/30 h-10"
                          placeholder={t("settings.githubTokenPlaceholder") as string}
                          value={githubToken()}
                          onInput={(e) => setGithubToken(e.currentTarget.value)}
                          disabled={busy()}
                        />
                      </TextField>
                    </div>
                  </div>
                </section>
              </TabsContent>
            </div>
          </Tabs>

          <div class="pt-6 border-t mt-auto shrink-0 pb-2">
            <Button
              type="button"
              class="w-full sm:w-40 font-bold h-11 shadow-md hover:shadow-lg transition-all"
              disabled={busy()}
              onClick={() => void onSave()}
            >
              <span class="iconify mdi--content-save mr-2 h-4 w-4" />
              {t("settings.save") as string}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
