import type { JSX } from "solid-js";

import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";

/**
 * Standard dialog frame: `Dialog > DialogContent > Header/Title + body + Footer`.
 * Covers the input/form/markdown/confirm shapes repeated across
 * PluginUiBridge and the feature dialogs. Fully custom dialogs
 * (e.g. QuickPick with preview pane) stay hand-rolled.
 */
export function DialogShell(props: {
  open: boolean;
  onClose: () => void;
  title: JSX.Element;
  children: JSX.Element;
  footer: JSX.Element;
  contentClass?: string;
  hideCloseButton?: boolean;
  contentKeyDown?: (e: KeyboardEvent) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent
        class={props.contentClass}
        hideCloseButton={props.hideCloseButton}
        onKeyDown={props.contentKeyDown}
      >
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
        </DialogHeader>
        {props.children}
        <DialogFooter>{props.footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
