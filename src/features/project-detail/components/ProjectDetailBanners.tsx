import { Show, type Component } from "solid-js";

import type { ProjectDetailModel } from "../model/createProjectDetailModel";

type ProjectDetailBannersProps = Readonly<{
  model: ProjectDetailModel;
}>;

export const ProjectDetailBanners: Component<ProjectDetailBannersProps> = (props) => {
  return (
    <>
      <Show when={props.model.banner()}>
        <div class="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-center text-sm text-destructive">
          {props.model.banner()}
        </div>
      </Show>
      <Show when={props.model.infoBanner()}>
        <div class="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-sm text-foreground">
          {props.model.infoBanner()}
        </div>
      </Show>
    </>
  );
};
