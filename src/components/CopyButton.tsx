import { Show, createSignal, onCleanup } from "solid-js";

import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * Icon button that copies `value` to the clipboard and shows
 * a transient check state. Single home for the copy buttons
 * previously duplicated in ProjectDetailHeader.
 */
export function CopyButton(props: {
  value: string;
  tooltip: string;
  iconClass?: string;
  checkClass?: string;
}) {
  const [copied, setCopied] = createSignal(false);
  let timer: number | undefined;
  onCleanup(() => window.clearTimeout(timer));

  return (
    <Tooltip>
      <TooltipTrigger
        as="button"
        type="button"
        class="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/60 hover:bg-muted/80 hover:text-foreground focus-visible:ring-0"
        onClick={(e) => {
          e.stopPropagation();
          void navigator.clipboard.writeText(props.value);
          setCopied(true);
          window.clearTimeout(timer);
          timer = window.setTimeout(() => setCopied(false), 2000);
        }}
      >
        <Show
          when={copied()}
          fallback={<span class={`iconify mdi--content-copy ${props.iconClass ?? "size-3.5"}`} />}
        >
          <span class={`iconify mdi--check ${props.checkClass ?? "size-3.5 text-green-500"}`} />
        </Show>
      </TooltipTrigger>
      <TooltipContent>{props.tooltip}</TooltipContent>
    </Tooltip>
  );
}
