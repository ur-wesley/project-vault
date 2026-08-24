import {
  Match,
  mergeProps,
  splitProps,
  Switch,
  type Component,
  type ComponentProps,
  type ValidComponent,
} from "solid-js";
import { cn } from "~/lib/utils";
import { Button, type ButtonProps } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { Sheet, SheetContent } from "~/components/ui/sheet";
import { TextField, TextFieldInput } from "~/components/ui/text-field";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { useI18n } from "~/lib/i18n-context";
import { SIDEBAR_WIDTH_MOBILE, useSidebar } from "./context";

export type SidebarProps = ComponentProps<"div"> & {
  side?: "left" | "right";
  variant?: "sidebar" | "floating" | "inset";
  collapsible?: "offcanvas" | "icon" | "none";
};

export const Sidebar: Component<SidebarProps> = (rawProps) => {
  const props = mergeProps<SidebarProps[]>(
    {
      side: "left",
      variant: "sidebar",
      collapsible: "offcanvas",
    },
    rawProps,
  );
  const [local, others] = splitProps(props, [
    "side",
    "variant",
    "collapsible",
    "class",
    "children",
  ]);

  const { isMobile, state, openMobile, setOpenMobile } = useSidebar();

  return (
    <Switch>
      <Match when={local.collapsible === "none"}>
        <div
          class={cn(
            "test w-(--sidebar-width) flex h-full flex-col bg-sidebar text-sidebar-foreground",
            local.class,
          )}
          {...others}
        >
          {local.children}
        </div>
      </Match>
      <Match when={isMobile()}>
        <Sheet open={openMobile()} onOpenChange={setOpenMobile} {...others}>
          <SheetContent
            data-sidebar="sidebar"
            data-mobile="true"
            class="w-(--sidebar-width) bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden"
            style={{
              "--sidebar-width": SIDEBAR_WIDTH_MOBILE,
            }}
            position={local.side}
          >
            <div class="flex size-full flex-col">{local.children}</div>
          </SheetContent>
        </Sheet>
      </Match>
      <Match when={!isMobile()}>
        <div
          class="group peer hidden md:block"
          data-state={state()}
          data-collapsible={state() === "collapsed" ? local.collapsible : ""}
          data-variant={local.variant}
          data-side={local.side}
        >
          <div
            class={cn(
              "w-(--sidebar-width) relative h-full bg-transparent transition-[width] duration-200 ease-linear",
              "group-data-[collapsible=offcanvas]:w-0",
              "group-data-[side=right]:rotate-180",
              local.variant === "floating" || local.variant === "inset"
                ? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)_+_theme(spacing.4))]"
                : "group-data-[collapsible=icon]:w-(--sidebar-width-icon)",
            )}
          />
          <div
            class={cn(
              "w-(--sidebar-width) fixed top-[var(--titlebar-height,0px)] bottom-0 z-10 hidden transition-[left,right,width] duration-200 ease-linear md:flex",
              local.side === "left"
                ? "left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]"
                : "right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]",
              local.variant === "floating" || local.variant === "inset"
                ? "p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)_+_theme(spacing.4)_+2px)]"
                : "group-data-[collapsible=icon]:w-(--sidebar-width-icon) group-data-[side=left]:border-r group-data-[side=right]:border-l group-data-[state=collapsed]:border-none",
              local.class,
            )}
            {...others}
          >
            <div
              data-sidebar="sidebar"
              class="flex size-full flex-col bg-sidebar group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:border-sidebar-border group-data-[variant=floating]:shadow"
            >
              {local.children}
            </div>
          </div>
        </div>
      </Match>
    </Switch>
  );
};

export const SidebarTrigger = <T extends ValidComponent = "button">(
  props: ButtonProps<T> & { onClick?: (event: MouseEvent) => void },
) => {
  const [local, others] = splitProps(props as any, ["class", "onClick"]);
  const { toggleSidebar } = useSidebar();
  const { t } = useI18n();

  return (
    <Button
      data-sidebar="trigger"
      variant="ghost"
      size="icon"
      class={cn("size-7", local.class)}
      onClick={(event: MouseEvent) => {
        local.onClick?.(event);
        toggleSidebar();
      }}
      {...others}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="size-4"
        aria-hidden="true"
      >
        <rect width="18" height="18" x="3" y="3" rx="2" />
        <path d="M9 3v18" />
      </svg>
      <span class="sr-only">{t("sidebar.toggle")}</span>
    </Button>
  );
};

export const SidebarRail: Component<ComponentProps<"button">> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  const { toggleSidebar } = useSidebar();
  const { t } = useI18n();

  return (
    <Tooltip>
      <TooltipTrigger
        as="button"
        data-sidebar="rail"
        aria-label={t("sidebar.toggle") as string}
        tabIndex={-1}
        onClick={toggleSidebar}
        class={cn(
          "absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 transition-all ease-linear after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] hover:after:bg-sidebar-border group-data-[side=left]:-right-4 group-data-[side=right]:left-0 sm:flex",
          "[[data-side=left]_&]:cursor-w-resize [[data-side=right]_&]:cursor-e-resize",
          "[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize",
          "group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full group-data-[collapsible=offcanvas]:hover:bg-sidebar",
          "[[data-side=left][data-collapsible=offcanvas]_&]:-right-2",
          "[[data-side=right][data-collapsible=offcanvas]_&]:-left-2",
          local.class,
        )}
        {...others}
      />
      <TooltipContent>{t("sidebar.toggle") as string}</TooltipContent>
    </Tooltip>
  );
};

export const SidebarInset: Component<ComponentProps<"main">> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <main
      class={cn(
        "relative flex min-h-0 flex-1 flex-col bg-background",
        "peer-data-[variant=inset]:min-h-[calc(100svh-theme(spacing.4))] md:peer-data-[variant=inset]:m-2 md:peer-data-[state=collapsed]:peer-data-[variant=inset]:ml-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow",
        local.class,
      )}
      {...others}
    />
  );
};

export const SidebarInput = <T extends ValidComponent = "input">(
  props: ComponentProps<typeof TextFieldInput<T>>,
) => {
  const [local, others] = splitProps(props as any, ["class"]);
  return (
    <TextField>
      <TextFieldInput
        data-sidebar="input"
        class={cn(
          "h-8 w-full bg-background shadow-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          local.class,
        )}
        {...others}
      />
    </TextField>
  );
};

export const SidebarHeader: Component<ComponentProps<"div">> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <div data-sidebar="header" class={cn("flex flex-col gap-2 p-2", local.class)} {...others} />
  );
};

export const SidebarFooter: Component<ComponentProps<"div">> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <div data-sidebar="footer" class={cn("flex flex-col gap-2 p-2", local.class)} {...others} />
  );
};

export const SidebarSeparator = <T extends ValidComponent = "hr">(
  props: ComponentProps<typeof Separator<T>>,
) => {
  const [local, others] = splitProps(props as any, ["class"]);
  return (
    <Separator
      data-sidebar="separator"
      class={cn("mx-2 w-auto bg-sidebar-border", local.class)}
      {...others}
    />
  );
};

export const SidebarContent: Component<ComponentProps<"div">> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <div
      data-sidebar="content"
      class={cn(
        "flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden",
        local.class,
      )}
      {...others}
    />
  );
};
