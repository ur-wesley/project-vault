import type { Component, JSX } from "solid-js";
import { splitProps } from "solid-js";

import { cn } from "~/lib/utils";
import { stackIconifyClass } from "~/lib/stack-icon";

export const StackIcon: Component<
  {
    stack: string;
    class?: string;
    title?: string;
  } & JSX.HTMLAttributes<HTMLSpanElement>
> = (raw) => {
  const [local, rest] = splitProps(raw, ["stack", "class", "title"]);
  return (
    <span
      class={cn(
        "box-content inline-block shrink-0 text-foreground [background-size:100%_100%]",
        stackIconifyClass(local.stack),
        local.class,
      )}
      title={local.title ?? local.stack}
      role="img"
      aria-label={local.stack}
      {...rest}
    />
  );
};
