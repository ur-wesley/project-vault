import { Show, type Component } from "solid-js";
import { isTauri } from "@tauri-apps/api/core";
import { Button } from "~/components/ui/button";
import { TabsContent } from "~/components/ui/tabs";
import { TextField, TextFieldInput } from "~/components/ui/text-field";

export type AccountsSettingsTabProps = Readonly<{
  t: (key: string) => string;
  busy: boolean;
  ghViewerQ: { data?: any | null };
  ghDeviceReadyQ: { isSuccess: boolean; isLoading: boolean; data?: boolean };
  onGithubDeviceSignIn: () => void;
  onSignOut: () => void;
  githubUserCode: string;
  githubToken: string;
  setGithubToken: (v: string) => void;
}>;

export const AccountsSettingsTab: Component<AccountsSettingsTabProps> = (props) => {
  return (
    <TabsContent value="accounts" class="space-y-8 outline-none animate-in fade-in duration-300">
      <section class="space-y-4">
        <div class="space-y-1">
          <h3 class="text-sm font-bold uppercase tracking-wider text-primary/80">{props.t("settings.githubTitle")}</h3>
          <p class="text-xs text-muted-foreground">
            {props.t("settings.githubDescription")}
          </p>
        </div>

        <div class="grid gap-6 max-w-sm">
          <div class="flex flex-col gap-3">
            <div class="flex flex-wrap items-center gap-3">
              <Show when={props.ghViewerQ.data} fallback={
                  <Button
                      type="button"
                      variant="secondary"
                      class="w-full bg-muted/40 h-10"
                      disabled={
                          props.busy ||
                          !isTauri() ||
                          props.ghDeviceReadyQ.isLoading ||
                          (props.ghDeviceReadyQ.isSuccess && !props.ghDeviceReadyQ.data)
                      }
                      onClick={() => props.onGithubDeviceSignIn()}
                  >
                      <span class="iconify mdi--github mr-2 h-4 w-4" />
                      {props.t("settings.githubSignIn")}
                  </Button>
              }>
                  <div class="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 w-full shadow-sm">
                      <div class="size-12 rounded-full bg-primary/10 flex items-center justify-center border-2 border-background shrink-0 overflow-hidden shadow-sm">
                          <Show when={props.ghViewerQ.data!.avatarUrl} fallback={<span class="iconify mdi--account size-7 text-primary/60" />}>
                              <img src={props.ghViewerQ.data!.avatarUrl!} alt="Avatar" class="size-full object-cover" />
                          </Show>
                      </div>
                      <div class="min-w-0 flex-1">
                          <p class="text-sm font-bold leading-tight truncate">{props.ghViewerQ.data!.login}</p>
                          <p class="text-[10px] text-primary/70 uppercase tracking-widest font-black mt-0.5">{props.t("settings.authenticated")}</p>
                      </div>
                      <Button
                          variant="ghost"
                          size="sm"
                          class="h-8 text-[10px] font-bold uppercase tracking-tighter text-muted-foreground hover:text-destructive hover:bg-destructive/5"
                          onClick={() => props.onSignOut()}
                      >
                          {props.t("settings.signOut")}
                      </Button>
                  </div>
              </Show>
              <Show when={isTauri() && props.ghDeviceReadyQ.isSuccess && !props.ghDeviceReadyQ.data}>
                <p class="text-xs text-destructive/80 font-medium leading-tight p-2 bg-destructive/5 border border-destructive/10 rounded-md">
                  {props.t("settings.githubDeviceNotConfigured")}
                </p>
              </Show>
            </div>

            <Show when={props.githubUserCode.length > 0}>
              <div class="rounded-lg bg-primary/10 p-5 border-2 border-primary/20 space-y-3 shadow-inner animate-pulse">
                <p class="text-[10px] font-black uppercase tracking-widest text-primary text-center">
                  {props.t("settings.githubDeviceCodeHint")}
                </p>
                <p class="font-mono text-3xl font-black tracking-[0.2em] text-foreground text-center">
                  {props.githubUserCode}
                </p>
              </div>
            </Show>
          </div>

          <div class="grid gap-2 pt-2">
            <label class="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              {props.t("settings.githubToken")}
            </label>
            <TextField>
              <TextFieldInput
                type="password"
                autocomplete="off"
                class="bg-muted/30 h-10"
                placeholder={props.t("settings.githubTokenPlaceholder")}
                value={props.githubToken}
                onInput={(e) => props.setGithubToken(e.currentTarget.value)}
                disabled={props.busy}
              />
            </TextField>
          </div>
        </div>
      </section>
    </TabsContent>
  );
};
