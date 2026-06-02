import { type Component } from "solid-js";
import { useI18n } from "~/lib/i18n-context";
import { useNotificationCenter } from "~/lib/notification-center";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Separator } from "~/components/ui/separator";
import { Switch, SwitchControl, SwitchThumb } from "~/components/ui/switch";

export const NotificationSettingsTab: Component = () => {
  const { t } = useI18n();
  const center = useNotificationCenter();

  return (
    <div class="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle class="flex items-center gap-2">
            <span class="iconify mdi--bell-outline size-4 text-primary" />
            {t("settings.notificationsTitle") as string}
          </CardTitle>
          <CardDescription>{t("settings.notificationsDescription") as string}</CardDescription>
        </CardHeader>
        <CardContent class="flex flex-col gap-2">
          <Separator />
          <div class="flex items-center justify-between gap-4 py-3">
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
          <div class="flex items-center justify-between gap-4 py-3">
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
        </CardContent>
      </Card>
    </div>
  );
};
