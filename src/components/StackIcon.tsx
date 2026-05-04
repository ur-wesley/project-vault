import type { Component, JSX } from "solid-js";
import { Show, splitProps } from "solid-js";

import { cn } from "~/lib/utils";
import { stackIconifyClass } from "~/lib/stack-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";

export const StackIcon: Component<
  {
    stack: string;
    class?: string;
    title?: string;
    noTooltip?: boolean;
  } & JSX.HTMLAttributes<HTMLSpanElement>
> = (raw) => {
  const [local, rest] = splitProps(raw, ["stack", "class", "title", "noTooltip"]);
  const tooltipText = local.title ?? local.stack;

  const icon = (
    <span
      class={cn(
        "box-content inline-block shrink-0 text-foreground [background-size:100%_100%]",
        stackIconifyClass(local.stack),
        local.class,
      )}
      role="img"
      aria-label={local.stack}
      {...rest}
    />
  );

  return (
    <Show when={!local.noTooltip} fallback={icon}>
      <Tooltip>
        <TooltipTrigger class="flex items-center justify-center">
          {icon}
        </TooltipTrigger>
        <TooltipContent>{tooltipText}</TooltipContent>
      </Tooltip>
    </Show>
  );
};
