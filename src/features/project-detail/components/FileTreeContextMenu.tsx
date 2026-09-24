import type { JSX } from "solid-js";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "~/components/ui/context-menu";
import { useI18n } from "~/lib/i18n-context";

export type FileEntryOp =
  | { kind: "newFile"; dirPath: string }
  | { kind: "newFolder"; dirPath: string }
  | { kind: "rename"; path: string; isDirectory: boolean }
  | { kind: "delete"; path: string; isDirectory: boolean };

const ICON_CLASS = "iconify size-3.5 shrink-0";

export function FileTreeContextMenu(props: {
  isDirectory: boolean;
  /** Directory that new entries are created in. */
  dirPath: string;
  /** Path of the entry itself, or null for the project root. */
  path: string | null;
  disabled?: boolean;
  children: JSX.Element;
  onOp: (op: FileEntryOp) => void;
}) {
  const { t } = useI18n();
  const isRoot = () => props.path === null;

  return (
    <ContextMenu>
      <ContextMenuTrigger as="div" class="contents">
        {props.children}
      </ContextMenuTrigger>
      <ContextMenuContent class="w-48">
        <ContextMenuItem
          class="gap-2 text-xs"
          disabled={props.disabled}
          onSelect={() => props.onOp({ kind: "newFile", dirPath: props.dirPath })}
        >
          <span class={ICON_CLASS + " mdi--file-plus-outline"} aria-hidden="true" />
          {t("projectDetail.newFile") as string}
        </ContextMenuItem>
        <ContextMenuItem
          class="gap-2 text-xs"
          disabled={props.disabled}
          onSelect={() => props.onOp({ kind: "newFolder", dirPath: props.dirPath })}
        >
          <span class={ICON_CLASS + " mdi--folder-plus-outline"} aria-hidden="true" />
          {t("projectDetail.newFolder") as string}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          class="gap-2 text-xs"
          disabled={props.disabled || isRoot()}
          onSelect={() => {
            if (props.path) {
              props.onOp({ kind: "rename", path: props.path, isDirectory: props.isDirectory });
            }
          }}
        >
          <span class={ICON_CLASS + " mdi--pencil-outline"} aria-hidden="true" />
          {t("projectDetail.renameEntry") as string}
        </ContextMenuItem>
        <ContextMenuItem
          class="gap-2 text-xs text-destructive focus:text-destructive"
          disabled={props.disabled || isRoot()}
          onSelect={() => {
            if (props.path) {
              props.onOp({ kind: "delete", path: props.path, isDirectory: props.isDirectory });
            }
          }}
        >
          <span class={ICON_CLASS + " mdi--trash-can-outline"} aria-hidden="true" />
          {t("projectDetail.deleteEntry") as string}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
