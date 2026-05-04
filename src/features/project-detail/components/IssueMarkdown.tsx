import { Show, createResource, type Component, onMount, onCleanup } from "solid-js";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { useI18n } from "~/lib/i18n-context";

export type IssueMarkdownProps = Readonly<{
  content: string;
}>;

const renderer = new marked.Renderer();
renderer.code = function (token) {
  const code = token.text;
  const lang = (token.lang || "").match(/\S*/)?.[0] || "";
  return `<pre class="notranslate border border-border/40"><button class="markdown-copy-btn" type="button" aria-label="Copy code"><span class="iconify mdi--content-copy h-3.5 w-3.5"></span></button><code class="language-${lang}">${code}</code></pre>`;
};

export const IssueMarkdown: Component<IssueMarkdownProps> = (props) => {
  const { t } = useI18n();
  // eslint-disable-next-line no-unassigned-vars — Solid ref pattern
  let containerRef: HTMLDivElement | undefined;

  const [html] = createResource(
    () => props.content,
    async (text) => {
      const parsed = await marked.parse(text, { renderer });
      return DOMPurify.sanitize(parsed);
    },
  );

  const handleCopy = async (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const btn = target.closest(".markdown-copy-btn") as HTMLButtonElement;
    if (!btn) return;

    const pre = btn.closest("pre");
    if (!pre) return;

    const code = pre.querySelector("code");
    const text = code ? code.innerText : pre.innerText.replace("Copy", "").trim();

    try {
      await navigator.clipboard.writeText(text);
      
      const icon = btn.querySelector(".iconify");
      if (icon) {
        const oldClass = icon.className;
        icon.className = "iconify mdi--check text-green-500 h-3.5 w-3.5";
        setTimeout(() => {
          icon.className = oldClass;
        }, 2000);
      }
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  onMount(() => {
    containerRef?.addEventListener("click", handleCopy);
  });

  onCleanup(() => {
    containerRef?.removeEventListener("click", handleCopy);
  });

  return (
    <div ref={containerRef} class="mx-auto w-full max-w-3xl prose prose-sm dark:prose-invert">
       <Show when={html()} fallback={<p class="animate-pulse text-muted-foreground text-xs">{t('common.rendering') as string}</p>}>
          <article class="markdown-body !bg-transparent !p-0" innerHTML={html()!} />
       </Show>
    </div>
  );
};
