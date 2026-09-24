import type { Component } from "solid-js";
import type { Accessor, Setter } from "solid-js";

import { Portal } from "solid-js/web";
import { Separator } from "~/components/ui/separator";
import type { useI18n } from "~/lib/i18n-context";
import type { ProjectDto } from "~/types/dto";
import type { ProjectDetailModel } from "../model/createProjectDetailModel";
import { TitlebarDesktopActions, type TitlebarActionProps } from "./TitlebarDesktopActions";
import { TitlebarMobileMenu } from "./TitlebarMobileMenu";

type T = ReturnType<typeof useI18n>["t"];

export type HeaderDialogSetters = {
  incomingOpen: Accessor<boolean>;
  setIncomingOpen: Setter<boolean>;
  setDeleteConfirmOpen: Setter<boolean>;
  setCleanDialogOpen: Setter<boolean>;
  setTagDialogOpen: Setter<boolean>;
};

/**
 * Titlebar portal: desktop action row + mobile dropdown, mounted into the
 * window title bar. (Extracted verbatim from ProjectDetailHeader.)
 */
export const HeaderTitlebarPortal: Component<{
  t: T;
  m: Accessor<ProjectDetailModel>;
  p: Accessor<ProjectDto>;
  pinned: Accessor<boolean>;
  tabsEnabled: Accessor<boolean>;
  dialogs: HeaderDialogSetters;
}> = (props) => {
  const actionProps: TitlebarActionProps = {
    t: props.t,
    m: props.m,
    p: props.p,
    pinned: props.pinned,
    tabsEnabled: props.tabsEnabled,
    incomingOpen: props.dialogs.incomingOpen,
    setIncomingOpen: props.dialogs.setIncomingOpen,
    setDeleteConfirmOpen: props.dialogs.setDeleteConfirmOpen,
    setCleanDialogOpen: props.dialogs.setCleanDialogOpen,
    setTagDialogOpen: props.dialogs.setTagDialogOpen,
  };

  return (
    <Portal mount={document.getElementById("window-title-bar-actions")!}>
      <div class="flex h-full items-stretch animate-in fade-in slide-in-from-right-2 duration-300">
        <Separator orientation="vertical" class="h-full w-px bg-border/60" />

        {/* Desktop View: Action Row */}
        <TitlebarDesktopActions {...actionProps} />

        {/* Mobile View: Dropdown Chevron */}
        <TitlebarMobileMenu {...actionProps} />
      </div>
    </Portal>
  );
};
