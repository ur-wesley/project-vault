import { type Component } from "solid-js";
import { useI18n } from "~/lib/i18n-context";
import { useNotificationCenter } from "~/lib/notification-center";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Separator } from "~/components/ui/separator";
import { Switch, SwitchControl, SwitchThumb } from "~/components/ui/switch";
import { settingElementId } from "../lib/settings-index";

export const NotificationSettingsTab: Component = () => {
  const { t } = useI18n();
  const center = useNotificationCenter();

  const triggerTestNotification = () => {
    center.notify({
      severity: "success",
      title: t("settings.testNotificationTitle") as string,
      body: t("settings.testNotificationBody") as string,
      durationMs: 5000,
      system: "always",
      persist: true,
    });
  };

  return (
    <div class="flex flex-col gap-4">
      <Card id={settingElementId("notifications-title")}>
        <CardHeader>
          <CardTitle class="flex items-center gap-2">
            <span class="iconify mdi--bell-outline size-4 text-primary" />
            {t("settings.notificationsTitle") as string}
          </CardTitle>
          <CardDescription>{t("settings.notificationsDescription") as string}</CardDescription>
        </CardHeader>
        <CardContent class="flex flex-col gap-2">
          <Separator />
          <div id={settingElementId("notifications-quiet")} class="flex items-center justify-between gap-4 py-3">
            <div class="flex flex-col gap-0.5">
              <span class="text-sm font-medium">{t("settings.quietTitle") as string}</span>
              <span class="text-xs text-muted-foreground">{t("settings.quietDescription") as string}</span>
            </div>
            <Switch
              checked={center.quiet()}
              onChange={center.setQuiet}
              aria-label={t("settings.quietToggle") as string}
            >
              <SwitchControl>
                <SwitchThumb />
              </SwitchControl>
            </Switch>
          </div>
          <Separator />
          <div id={settingElementId("notifications-os")} class="flex items-center justify-between gap-4 py-3">
            <div class="flex flex-col gap-0.5">
              <span class="text-sm font-medium">{t("settings.osTitle") as string}</span>
              <span class="text-xs text-muted-foreground">{t("settings.osDescription") as string}</span>
            </div>
            <Switch
              checked={center.systemEnabled()}
              onChange={center.setSystemEnabled}
              aria-label={t("settings.osToggle") as string}
            >
              <SwitchControl>
                <SwitchThumb />
              </SwitchControl>
            </Switch>
          </div>
          <Separator />
          <div id={settingElementId("notifications-test")} class="flex items-center justify-between gap-4 py-3">
            <div class="flex flex-col gap-0.5">
              <span class="text-sm font-medium">{t("settings.testNotificationLabel") as string}</span>
              <span class="text-xs text-muted-foreground">{t("settings.testNotificationDesc") as string}</span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="h-9 gap-1.5 text-xs bg-muted/20 border-border/60 hover:bg-primary/10 hover:text-primary transition-all duration-200"
              onClick={triggerTestNotification}
            >
              <span class="iconify mdi--bell-ring size-4 text-primary" />
              {t("settings.testNotificationButton") as string}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
