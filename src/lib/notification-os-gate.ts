export type OsNotificationGateItem = {
  system: "auto" | "always" | "never";
  systemSent: boolean;
};

export type OsNotificationGateContext = {
  quiet: boolean;
  systemEnabled: boolean;
  focused: boolean;
};

export function shouldSendOsNotification(
  item: OsNotificationGateItem,
  ctx: OsNotificationGateContext,
): boolean {
  if (ctx.quiet) return false;
  if (item.system === "never") return false;
  if (item.system !== "always" && !ctx.systemEnabled) return false;
  if (item.system === "auto" && ctx.focused) return false;
  if (item.systemSent) return false;
  return true;
}
