import type { Component, JSX } from "solid-js";
import { splitProps } from "solid-js";

import { cn } from "~/lib/utils";

type ButtonGroupProps = {
  class?: string;
  children: JSX.Element;
};

const ButtonGroup: Component<ButtonGroupProps> = (props) => {
  const [local, rest] = splitProps(props, ["class", "children"]);
  return (
    <div
      class={cn(
        "inline-flex w-fit -space-x-px rounded-md border border-border bg-background p-0 shadow-sm",
        "[&>button]:relative [&>button]:z-0 focus-within:[&>button]:z-0",
        "[&>button]:rounded-none [&>button]:shadow-none",
        "[&>button]:ring-offset-0",
        "[&>button:focus-visible]:z-10",
        "[&>button:first-of-type]:rounded-l-md",
        "[&>button:last-of-type]:rounded-r-md",
        local.class,
      )}
      data-slot="button-group"
      role="group"
      {...rest}
    >
      {local.children}
    </div>
  );
};

export { ButtonGroup };
