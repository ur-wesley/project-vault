import { Show, createResource, type Component, onMount, onCleanup } from "solid-js";
import { useI18n } from "~/lib/i18n-context";
import { onMarkdownCopyClick } from "~/lib/markdown-copy";
import { renderMarkdownHtml } from "~/services/markdown";

export type IssueMarkdownProps = Readonly<{
  content: string;
}>;

export const IssueMarkdown: Component<IssueMarkdownProps> = (props) => {
  const { t } = useI18n();
  // eslint-disable-next-line no-unassigned-vars — Solid ref pattern
  let containerRef: HTMLDivElement | undefined;

  const [html] = createResource(
    () => props.content,
    async (text) => await renderMarkdownHtml(text),
  );

  const handleCopy = (e: MouseEvent) => {
    void onMarkdownCopyClick(e);
  };

  onMount(() => {
    containerRef?.addEventListener("click", handleCopy);
  });

  onCleanup(() => {
    containerRef?.removeEventListener("click", handleCopy);
  });

  return (
    <div ref={containerRef} class="w-full prose prose-sm dark:prose-invert">
      <Show
        when={html()}
        fallback={
          <p class="animate-pulse text-muted-foreground text-xs">
            {t("common.rendering") as string}
          </p>
        }
      >
        <article class="markdown-body !bg-transparent !p-0" innerHTML={html()!} />
      </Show>
    </div>
  );
};
