import { For, Show, createMemo, createSignal, type Component, onCleanup, onMount } from "solid-js";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { Separator } from "~/components/ui/separator";
import { Switch, SwitchControl, SwitchThumb } from "~/components/ui/switch";
import { useI18n } from "~/lib/i18n-context";
import { useEventHub } from "~/lib/event-hub-context";
import {
  runNotificationActionCommand,
  useNotificationCenter,
  type NotificationItem,
  type NotificationSeverity,
} from "~/lib/notification-center";
import { cn } from "~/lib/utils";

const SEVERITY_ICON: Record<NotificationSeverity, string> = {
  info: "mdi--information-outline",
  success: "mdi--check-circle-outline",
  warning: "mdi--alert-outline",
  error: "mdi--close-circle-outline",
};

const SEVERITY_COLOR: Record<NotificationSeverity, string> = {
  info: "text-sky-400",
  success: "text-emerald-400",
  warning: "text-amber-400",
  error: "text-red-400",
};

const SEVERITY_BG: Record<NotificationSeverity, string> = {
  info: "bg-sky-500/10",
  success: "bg-emerald-500/10",
  warning: "bg-amber-500/10",
  error: "bg-red-500/10",
};

type Group = { key: string; label: string; items: NotificationItem[] };

const ONE_DAY = 24 * 60 * 60 * 1000;

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function groupItems(items: NotificationItem[], t: (k: string) => unknown): Group[] {
  const now = Date.now();
  const todayStart = startOfDay(now);
  const yesterdayStart = todayStart - ONE_DAY;
  const weekStart = todayStart - 6 * ONE_DAY;

  const today: NotificationItem[] = [];
  const yesterday: NotificationItem[] = [];
  const thisWeek: NotificationItem[] = [];
  const older: NotificationItem[] = [];

  for (const it of items) {
    const dayStart = startOfDay(it.createdAt);
    if (dayStart >= todayStart) today.push(it);
    else if (dayStart >= yesterdayStart) yesterday.push(it);
    else if (dayStart >= weekStart) thisWeek.push(it);
    else older.push(it);
  }

  const groups: Group[] = [];
  if (today.length) groups.push({ key: "today", label: t("notificationCenter.groupToday") as string, items: today });
  if (yesterday.length) groups.push({ key: "yesterday", label: t("notificationCenter.groupYesterday") as string, items: yesterday });
  if (thisWeek.length) groups.push({ key: "thisWeek", label: t("notificationCenter.groupThisWeek") as string, items: thisWeek });
  if (older.length) groups.push({ key: "older", label: t("notificationCenter.groupOlder") as string, items: older });
  return groups;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

const NotificationRow: Component<{
  item: NotificationItem;
  onAction: (a: { run?: () => void | Promise<void>; command?: string }) => void;
  onDismiss: () => void;
}> = (props) => {
  const { t } = useI18n();
  const iconName = () => props.item.icon || SEVERITY_ICON[props.item.severity];

  return (
    <div
      class={cn(
        "group relative flex flex-col gap-1.5 rounded-md border border-transparent p-2.5 text-left transition-colors hover:border-border/40 hover:bg-accent/30",
        !props.item.read && "bg-accent/15",
      )}
    >
      {/* Header Row: Icon, App Name/Source, Unread Badge, Time */}
      <div class="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground/60">
        <div class={cn("flex size-5 shrink-0 items-center justify-center rounded-md", SEVERITY_BG[props.item.severity])}>
          <span class={cn("iconify size-3", iconName(), SEVERITY_COLOR[props.item.severity])} />
        </div>
        <span class="font-medium truncate">{props.item.source ?? (t("notificationCenter.sourceSystem") as string)}</span>
        <Show when={!props.item.read}>
          <span class="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
        </Show>
        <span class="ml-auto font-mono text-[9px] text-muted-foreground/70">{formatTime(props.item.createdAt)}</span>
      </div>

      {/* Title & Body Content */}
      <div class="flex min-w-0 flex-col gap-0.5 pl-0.5">
        <span class="truncate text-xs font-semibold leading-snug text-foreground">{props.item.title}</span>
        <Show when={props.item.body}>
          <p class="whitespace-pre-wrap text-xs leading-snug text-muted-foreground">{props.item.body}</p>
        </Show>
        <Show when={props.item.progress}>
          {(progress) => (
            <div class="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
              <Show
                when={!progress().indeterminate && typeof progress().value === "number"}
                fallback={<div class="h-full w-1/3 animate-pulse bg-primary/60" />}
              >
                <div
                  class="h-full bg-primary transition-all"
                  style={{ width: `${Math.max(0, Math.min(100, progress().value ?? 0))}%` }}
                />
              </Show>
            </div>
          )}
        </Show>
        <Show when={props.item.actions && props.item.actions!.length > 0}>
          <div class="mt-1.5 flex flex-wrap gap-1.5">
            <For each={props.item.actions}>
              {(a) => (
                <Button
                  type="button"
                  variant={a.primary ? "default" : "outline"}
                  size="sm"
                  class="h-6 px-2 text-[10px]"
                  onClick={() => props.onAction(a)}
                >
                  {a.label}
                </Button>
              )}
            </For>
          </div>
        </Show>
      </div>

      <button
        type="button"
        aria-label={t("common.dismiss") as string}
        class="absolute right-1 top-1 rounded p-0.5 text-muted-foreground/60 opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          props.onDismiss();
        }}
      >
        <span class="iconify mdi--close size-3" />
      </button>
    </div>
  );
};

export const NotificationCenter: Component<{ projectId?: string | null }> = (props) => {
  const { t } = useI18n();
  const hub = useEventHub();
  const center = useNotificationCenter();
  const [open, setOpen] = createSignal(false);

  const groups = createMemo(() => groupItems(center.items(), (k) => t(k as any) as string));
  const hasUnread = createMemo(() => center.unreadCount() > 0);

  const handleAction = async (action: { run?: () => void | Promise<void>; command?: string }) => {
    if (action.run) {
      try {
        await action.run();
      } catch (e) {
        console.error("[NotificationCenter] action run failed:", e);
      }
      return;
    }
    if (action.command) {
      await runNotificationActionCommand(action.command, props.projectId ?? null);
    }
  };

  // Listen for the toggle-shortcut event coming through the bus.
  let unlistenToggle: (() => void) | undefined;
  onMount(() => {
    unlistenToggle = hub.on("shortcut:action", (payload) => {
      if (payload.action === "notification-center:toggle") {
        setOpen((o) => !o);
      }
    });
  });
  onCleanup(() => unlistenToggle?.());

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) center.markAllRead();
  };

  return (
    <div>
      <Popover open={open()} onOpenChange={handleOpenChange} placement="top-end">
        <Tooltip>
          <TooltipTrigger
            as={PopoverTrigger}
            class="relative flex h-6 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <span class="iconify mdi--bell-outline size-3.5" />
            <Show when={hasUnread()}>
              <span
                aria-label={t("notificationCenter.newBadge") as string}
                class="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold leading-none text-primary-foreground"
              >
                {center.unreadCount() > 99 ? "99+" : center.unreadCount()}
              </span>
            </Show>
          </TooltipTrigger>
          <TooltipContent>{t("notificationCenter.bellTooltip") as string}</TooltipContent>
        </Tooltip>
        <PopoverContent class="w-[380px] p-0 text-foreground shadow-xl border-border/40">
          <div class="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-2">
            <div class="flex items-center gap-2">
              <span class="text-sm font-semibold">{t("notificationCenter.title") as string}</span>
              <Show when={hasUnread()}>
                <span class="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  {center.unreadCount()}
                </span>
              </Show>
            </div>
            <div class="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger
                  as={Button}
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="h-6 px-1.5 text-[10px] text-muted-foreground"
                  disabled={center.items().length === 0}
                  onClick={() => center.markAllRead()}
                >
                  <span class="iconify mdi--check-all size-3" />
                </TooltipTrigger>
                <TooltipContent>{t("notificationCenter.markAllRead") as string}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  as={Button}
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="h-6 px-1.5 text-[10px] text-muted-foreground"
                  disabled={center.items().length === 0}
                  onClick={() => center.clearRead()}
                >
                  <span class="iconify mdi--broom size-3" />
                </TooltipTrigger>
                <TooltipContent>{t("notificationCenter.clearRead") as string}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  as={Button}
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="h-6 px-1.5 text-[10px] text-muted-foreground"
                  disabled={center.items().length === 0}
                  onClick={() => center.clear()}
                >
                  <span class="iconify mdi--delete-outline size-3" />
                </TooltipTrigger>
                <TooltipContent>{t("notificationCenter.clearAll") as string}</TooltipContent>
              </Tooltip>
            </div>
          </div>

          <div class="max-h-[420px] overflow-y-auto px-1.5 py-1.5">
            <Show
              when={center.items().length > 0}
              fallback={
                <div class="flex flex-col items-center gap-2 px-4 py-10 text-center">
                  <span class="iconify mdi--bell-off-outline size-7 text-muted-foreground/50" />
                  <span class="text-xs font-medium text-muted-foreground">{t("notificationCenter.empty") as string}</span>
                  <span class="max-w-[260px] text-[10px] text-muted-foreground/70">{t("notificationCenter.emptyHint") as string}</span>
                </div>
              }
            >
              <For each={groups()}>
                {(group) => (
                  <div class="mb-1.5 last:mb-0">
                    <div class="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                      {group.label}
                    </div>
                    <div class="flex flex-col gap-1">
                      <For each={group.items}>
                        {(item) => (
                          <div data-notification-id={item.id}>
                            <NotificationRow
                              item={item}
                              onAction={(a) => void handleAction(a)}
                              onDismiss={() => center.dismiss(item.id)}
                            />
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </div>

          <Separator />
          <div class="flex items-center justify-between gap-2 px-3 py-1.5">
            <span class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span class="iconify mdi--moon-waning-crescent size-3" />
              {t("notificationCenter.quiet") as string}
            </span>
            <div class="flex items-center gap-2">
              <span class="text-[10px] text-muted-foreground/60">{t("notificationCenter.quietHint") as string}</span>
              <Switch
                checked={center.quiet()}
                onChange={center.setQuiet}
                aria-label={t("notificationCenter.quiet") as string}
              >
                <SwitchControl>
                  <SwitchThumb />
                </SwitchControl>
              </Switch>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};
