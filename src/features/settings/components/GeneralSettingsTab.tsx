import { Show, createMemo, createSignal, type Component } from "solid-js";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Label } from "~/components/ui/label";
import { Select } from "~/components/ui/select";
import { TabsContent } from "~/components/ui/tabs";
import { TextField, TextFieldInput } from "~/components/ui/text-field";
import type { Locale } from "~/messages";
import { debugScanLocation } from "~/services/tauri";
import pkg from "../../../../package.json";

export type GeneralSettingsTabProps = Readonly<{
  t: (key: string, args?: Record<string, unknown>) => string;
  selectedLocale: Locale;
  setSelectedLocale: (l: Locale) => void;
  scanMinutes: string;
  setScanMinutes: (v: string) => void;
  autoIndex: boolean;
  setAutoIndex: (v: boolean) => void;
  autoCheckUpdates: boolean;
  setAutoCheckUpdates: (v: boolean) => void;
  busy: boolean;
  onExport: () => void;
  onOpenAppDataDir?: () => void;
  onRebuildDatabase?: () => void;
  onCheckForUpdates?: () => void;
}>;

type LocaleOption = { value: Locale; label: string; textValue: string };

export const GeneralSettingsTab: Component<GeneralSettingsTabProps> = (props) => {
  const localeOptions = createMemo((): LocaleOption[] => [
    { value: "en", label: props.t("settings.languageEnglish"), textValue: "English" },
    { value: "de", label: props.t("settings.languageGerman"), textValue: "Deutsch" },
  ]);

  const currentLocaleOption = createMemo(() =>
    localeOptions().find(o => o.value === props.selectedLocale) ?? localeOptions()[0]
  );

  const [debugPath, setDebugPath] = createSignal("");
  const [debugResult, setDebugResult] = createSignal<string>("");
  const [debugBusy, setDebugBusy] = createSignal(false);

  const runDebugScan = async () => {
    const p = debugPath().trim();
    if (!p) return;
    setDebugBusy(true);
    setDebugResult("Scanning...");
    try {
      const r = await debugScanLocation(p);
      if (r.isErr()) {
        setDebugResult(`Error: ${r.error.message}`);
        return;
      }
      const data = r.value;
      const rawLines = data.raw.map(d => `  [RAW] ${d.name} | stack=${d.stack} | tags=[${d.tags.join(", ")}] | path=${d.root}`);
      const filteredLines = data.filtered.map(d => `  [OUT] ${d.name} | stack=${d.stack} | tags=[${d.tags.join(", ")}] | path=${d.root}`);
      setDebugResult(
        `Raw drafts: ${data.raw.length}\n${rawLines.join("\n")}\n\n` +
        `Filtered: ${data.filtered.length} | monorepos=${data.monoreposExpanded} | warnings=${data.workspaceWarnings}\n` +
        filteredLines.join("\n")
      );
    } catch (e) {
      setDebugResult(`Exception: ${String(e)}`);
    } finally {
      setDebugBusy(false);
    }
  };

  return (
    <TabsContent value="general" class="space-y-8 outline-none animate-in fade-in duration-300">
      <section class="space-y-4">
        <div class="space-y-1">
          <h3 class="text-sm font-bold uppercase tracking-wider text-primary/80">{props.t("settings.interfaceTitle")}</h3>
          <p class="text-xs text-muted-foreground">
            {props.t("settings.interfaceDescription")}
          </p>
        </div>
        <div class="grid gap-6 max-w-sm">
          <div class="grid gap-2">
            <label class="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              {props.t("settings.language")}
            </label>
            <Select<LocaleOption>
              options={localeOptions()}
              optionValue="value"
              optionTextValue="textValue"
              value={currentLocaleOption()}
              onChange={(o) => o && props.setSelectedLocale(o.value)}
              disabled={props.busy}
              itemComponent={(p) => (
                <Select.Item item={p.item}>
                  <Select.ItemLabel>{p.item.rawValue.label}</Select.ItemLabel>
                </Select.Item>
              )}
            >
              <Select.Trigger class="bg-muted/30 h-10">
                <Select.Value<LocaleOption>>
                  {(s) => (
                    <span class="truncate">
                      {s.selectedOption()?.label ?? props.t("settings.language")}
                    </span>
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
              {props.t("settings.scanInterval")}
            </label>
            <TextField>
              <TextFieldInput
                type="number"
                min={0}
                class="bg-muted/30"
                value={props.scanMinutes}
                onInput={(e) => props.setScanMinutes(e.currentTarget.value)}
                disabled={props.busy}
                autocomplete="off"
              />
            </TextField>
          </div>

          <div class="grid gap-2">
            <label class="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              {props.t("settings.autoIndexTitle")}
            </label>
            <p class="text-xs text-muted-foreground">
              {props.t("settings.autoIndexDescription")}
            </p>
            <div class="flex items-start space-x-3 pt-1">
              <Checkbox
                id="auto-index"
                checked={props.autoIndex}
                onChange={(checked) => props.setAutoIndex(checked)}
              />
              <div class="grid gap-1.5 leading-none pt-0.5">
                <Label
                  for="auto-index"
                  class="text-sm font-medium leading-none cursor-pointer"
                >
                  {props.t("settings.autoIndexToggle")}
                </Label>
              </div>
            </div>
          </div>

          <div class="grid gap-2">
            <label class="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              {props.t("settings.updatesTitle")}
            </label>
            <p class="text-xs text-muted-foreground">
              {props.t("settings.updatesDescription")}
            </p>
            <div class="flex items-start space-x-3 pt-1">
              <Checkbox
                id="auto-check-updates"
                checked={props.autoCheckUpdates}
                onChange={(checked) => props.setAutoCheckUpdates(checked)}
              />
              <div class="grid gap-1.5 leading-none pt-0.5">
                <Label
                  for="auto-check-updates"
                  class="text-sm font-medium leading-none cursor-pointer"
                >
                  {props.t("settings.autoCheckUpdatesToggle")}
                </Label>
              </div>
            </div>
            <div class="flex items-center gap-2 pt-1">
              <Show when={props.onCheckForUpdates}>
                <Button
                  variant="outline"
                  size="sm"
                  class="h-8 text-xs"
                  disabled={props.busy}
                  onClick={() => props.onCheckForUpdates?.()}
                >
                  {props.t("settings.checkForUpdates")}
                </Button>
              </Show>
              <span class="text-[10px] text-muted-foreground font-mono">
                v{pkg.version}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section class="space-y-4">
        <div class="space-y-1">
          <h3 class="text-sm font-bold uppercase tracking-wider text-primary/80">{props.t("settings.dataTitle")}</h3>
          <p class="text-xs text-muted-foreground">
            {props.t("settings.dataDescription")}
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            class="w-full sm:w-auto bg-muted/20 border-border/60"
            disabled={props.busy}
            onClick={() => props.onExport()}
          >
            <span class="iconify mdi--download mr-2 h-4 w-4" />
            {props.t("settings.export")}
          </Button>
          <Show when={props.onOpenAppDataDir}>
            <Button
              type="button"
              variant="outline"
              class="w-full sm:w-auto bg-muted/20 border-border/60"
              disabled={props.busy}
              onClick={() => props.onOpenAppDataDir?.()}
            >
              <span class="iconify mdi--folder-open mr-2 h-4 w-4" />
              {props.t("settings.openAppDataDir")}
            </Button>
          </Show>
        </div>
      </section>

      <section class="space-y-4">
        <div class="space-y-1">
          <h3 class="text-sm font-bold uppercase tracking-wider text-destructive/80">{props.t("settings.maintenanceTitle")}</h3>
          <p class="text-xs text-muted-foreground">
            {props.t("settings.maintenanceDescription")}
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <Show when={props.onRebuildDatabase}>
            <Button
              type="button"
              variant="outline"
              class="w-full sm:w-auto bg-destructive/5 border-destructive/20 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={props.busy}
              onClick={() => props.onRebuildDatabase?.()}
            >
              <span class="iconify mdi--database-refresh mr-2 h-4 w-4" />
              {props.t("settings.rebuildDatabase")}
            </Button>
          </Show>
        </div>
      </section>

      <section class="space-y-4">
        <div class="space-y-1">
          <h3 class="text-sm font-bold uppercase tracking-wider text-primary/80">Debug Scan</h3>
          <p class="text-xs text-muted-foreground">
            Test discovery on a specific folder without modifying the database.
          </p>
        </div>
        <div class="grid gap-3">
          <div class="flex gap-2">
            <TextField class="flex-1">
              <TextFieldInput
                type="text"
                class="bg-muted/30 font-mono text-xs"
                placeholder="C:\\projects\\my-repo"
                value={debugPath()}
                onInput={(e) => setDebugPath(e.currentTarget.value)}
                disabled={debugBusy()}
              />
            </TextField>
            <Button
              type="button"
              variant="secondary"
              class="h-9 text-xs font-bold uppercase"
              disabled={debugBusy()}
              onClick={() => void runDebugScan()}
            >
              <span class="iconify mdi--magnify mr-1.5 h-4 w-4" />
              Scan
            </Button>
          </div>
          <Show when={debugResult()}>
            <pre class="max-h-60 overflow-auto rounded-md bg-muted/50 p-3 text-[10px] font-mono leading-relaxed text-foreground/80">
              {debugResult()}
            </pre>
          </Show>
        </div>
      </section>
    </TabsContent>
  );
};
