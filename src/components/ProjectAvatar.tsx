import { createEffect, createSignal, Show, type Component } from "solid-js";
import { StackIcon } from "~/components/StackIcon";
import { projectIconSrc } from "~/lib/project-icon";
import { cn } from "~/lib/utils";
import type { ProjectDto } from "~/types/dto";

export const ProjectAvatar: Component<{
  project: Pick<ProjectDto, "path" | "stack" | "iconPath">;
  class?: string;
  noTooltip?: boolean;
}> = (props) => {
  const [failed, setFailed] = createSignal(false);

  createEffect(() => {
    props.project.iconPath;
    setFailed(false);
  });

  return (
    <Show
      when={!failed() && props.project.iconPath}
      fallback={
        <StackIcon
          stack={props.project.stack}
          class={props.class}
          noTooltip={props.noTooltip}
        />
      }
    >
      {(iconPath) => (
        <img
          src={projectIconSrc(props.project.path, iconPath())}
          alt=""
          class={cn("shrink-0 object-cover rounded-sm", props.class)}
          onError={() => setFailed(true)}
        />
      )}
    </Show>
  );
};
