import { type Component } from "solid-js";
import { isTauri } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";

import { Button } from "~/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "~/components/ui/tabs";
import { useI18n } from "~/lib/i18n-context";
import type { Locale } from "~/messages";
import { LocationManager } from "../locations";
import { getAppDataDir } from "~/services/tauri/settings";
import { stableErrorMessage } from "~/lib/invoke-error";
import pkg from "../../../package.json";

import { useSettingsModel } from "./model/useSettingsModel";
import { GeneralSettingsTab } from "./components/GeneralSettingsTab";
import { ToolsSettingsTab } from "./components/ToolsSettingsTab";
import { AccountsSettingsTab } from "./components/AccountsSettingsTab";
import { ShortcutsSettingsTab } from "./components/ShortcutsSettingsTab";
import { TemplatesSettingsTab } from "./components/TemplatesSettingsTab";

async function safeConfirm(message: string): Promise<boolean> {
  if (isTauri()) {
    return await ask(message, {
      title: "Project Vault",
      kind: "warning",
    });
  }
  return window.confirm(message);
}

export type SettingsViewProps = Readonly<{
  activeTab: string;
  onTabChange: (v: string) => void;
  onBack: () => void;
  onLocaleChange?: (l: Locale) => void;
}>;

export const SettingsView: Component<SettingsViewProps> = (props) => {
  const { t, locale } = useI18n();
  const tAny = (k: any, a?: any) => t(k, a) as string;
  const model = useSettingsModel({
    t: tAny,
    locale,
    onLocaleChange: props.onLocaleChange,
  });

  const onOpenAppDataDir = async () => {
    if (!isTauri()) return;
    const r = await getAppDataDir();
    if (r.isErr()) {
      window.alert(stableErrorMessage(tAny, r.error));
      return;
    }
    try {
      await openPath(r.value);
    } catch (e) {
      window.alert(`${t("settings.openAppDataDirFailed") as string} ${String(e)}`);
    }
  };

  return (
    <div class="flex h-full flex-col overflow-hidden bg-background font-sans">
      <header class="flex h-14 shrink-0 items-center gap-4 border-b px-6">
        <Button variant="ghost" size="icon" onClick={() => props.onBack()} class="h-8 w-8">
          <span class="iconify mdi--arrow-left h-4 w-4" />
        </Button>
        <div class="flex items-center gap-2">
          <h2 class="text-lg font-bold tracking-tight">{t("settings.title") as string}</h2>
          <span class="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
            v{pkg.version}
          </span>
        </div>
        <Button
          type="button"
          class="ml-auto font-bold h-9 shadow-sm hover:shadow-md transition-all"
          disabled={model.busy()}
          onClick={() => void model.onSave()}
        >
          <span class="iconify mdi--content-save mr-2 h-4 w-4" />
          {t("settings.save") as string}
        </Button>
      </header>

      <div class="flex-1 overflow-hidden px-6 py-6">
        <div class="mx-auto max-w-2xl h-full flex flex-col gap-6">
          <Tabs
            value={props.activeTab}
            onChange={props.onTabChange}
            class="flex flex-1 flex-col overflow-hidden"
          >
            <TabsList class="mb-6 w-full flex bg-muted/40 p-1">
              <TabsTrigger value="general" class="flex-1 font-semibold text-xs uppercase tracking-wider">
                {t("settings.tabGeneral") as string}
              </TabsTrigger>
              <TabsTrigger value="locations" class="flex-1 font-semibold text-xs uppercase tracking-wider">
                {t("settings.tabLocations") as string}
              </TabsTrigger>
              <TabsTrigger value="tools" class="flex-1 font-semibold text-xs uppercase tracking-wider">
                {t("settings.tabTools") as string}
              </TabsTrigger>
              <TabsTrigger value="shortcuts" class="flex-1 font-semibold text-xs uppercase tracking-wider">
                {t("settings.tabShortcuts") as string}
              </TabsTrigger>
              <TabsTrigger value="templates" class="flex-1 font-semibold text-xs uppercase tracking-wider">
                {t("settings.tabTemplates") as string}
              </TabsTrigger>
              <TabsTrigger value="accounts" class="flex-1 font-semibold text-xs uppercase tracking-wider">
                {t("settings.tabAccounts") as string}
              </TabsTrigger>
            </TabsList>

            <div class="flex-1 overflow-y-auto px-1 pr-2 scrollbar-none">
              <GeneralSettingsTab
                t={tAny}
                selectedLocale={model.selectedLocale()}
                setSelectedLocale={model.setSelectedLocale}
                scanMinutes={model.scanMinutes()}
                setScanMinutes={model.setScanMinutes}
                autoIndex={model.autoIndex()}
                setAutoIndex={model.setAutoIndex}
                autoCheckUpdates={model.autoCheckUpdates()}
                setAutoCheckUpdates={model.setAutoCheckUpdates}
                autoStart={model.autoStart()}
                setAutoStart={model.setAutoStart}
                portlessEnabled={model.portlessEnabled()}
                setPortlessEnabled={model.setPortlessEnabled}
                portlessProxyPort={model.portlessProxyPort()}
                setPortlessProxyPort={model.setPortlessProxyPort}
                portlessTls={model.portlessTls()}
                setPortlessTls={model.setPortlessTls}
                portlessAvailable={model.portlessAvailable()}
                globalTerminalCwd={model.globalTerminalCwd()}
                setGlobalTerminalCwd={model.setGlobalTerminalCwd}
                screenshotSaveDir={model.screenshotSaveDir()}
                setScreenshotSaveDir={model.setScreenshotSaveDir}
                busy={model.busy()}
                onExport={model.onExport}
                onOpenAppDataDir={onOpenAppDataDir}
                onRebuildDatabase={() => void model.onRebuildDatabase(safeConfirm)}
                onCheckForUpdates={() => void model.onCheckForUpdates()}
              />

              <TabsContent value="locations" class="outline-none animate-in fade-in duration-300">
                <LocationManager />
              </TabsContent>

              <ToolsSettingsTab
                t={tAny}
                busy={model.busy()}
                idesQ={model.idesQ}
                shellsQ={model.shellsQ}
                toolsQ={model.toolsQ}
                defaultIde={model.defaultIde()}
                setDefaultIde={model.setDefaultIde}
                defaultShell={model.defaultShell()}
                setDefaultShell={model.setDefaultShell}
                shellPath={model.shellPath()}
                setShellPath={model.setShellPath}
              />

              <TabsContent value="shortcuts" class="outline-none animate-in fade-in duration-300">
                <ShortcutsSettingsTab t={tAny} />
              </TabsContent>

              <TabsContent value="templates" class="outline-none animate-in fade-in duration-300">
                <TemplatesSettingsTab t={tAny} />
              </TabsContent>

              <AccountsSettingsTab
                t={tAny}
                busy={model.busy()}
                ghViewerQ={model.ghViewerQ}
                ghDeviceReadyQ={model.ghDeviceReadyQ}
                onGithubDeviceSignIn={model.onGithubDeviceSignIn}
                onSignOut={() => model.onSignOut(safeConfirm)}
                githubUserCode={model.githubUserCode()}
                githubToken={model.githubToken()}
                setGithubToken={model.setGithubToken}
              />
            </div>
          </Tabs>


        </div>
      </div>
    </div>
  );
};
