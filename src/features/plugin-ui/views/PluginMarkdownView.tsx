import { Show, type Component } from "solid-js";
import { IssueMarkdown } from "~/features/project-detail/components/IssueMarkdown";

export const PluginMarkdownView: Component<{
  content?: string;
}> = (props) => {
  return (
    <div class="rounded-md border border-border/50 bg-card px-4 py-3">
      <Show
        when={(props.content ?? "").trim().length > 0}
        fallback={<p class="text-xs text-muted-foreground">No content</p>}
      >
        <IssueMarkdown content={props.content ?? ""} />
      </Show>
    </div>
  );
};
