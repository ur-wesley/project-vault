import { Show, createResource } from "solid-js";

import { renderMarkdownHtml } from "~/services/markdown";
import type { PreviewKind } from "../lib/file-editor";

/**
 * Rendered preview of the live editor buffer (unsaved edits included).
 * Unlike FilePreview this never touches disk — `text` is the tab's current
 * model content. Markdown shares FilePreview's themed markup; HTML renders
 * sandboxed with scripts disabled.
 */
export function LivePreview(props: { kind: PreviewKind; text: string }) {
  const [html] = createResource(
    () => (props.kind === "markdown" ? props.text : null),
    async (text) => {
      if (text === null) return null;
      try {
        return await renderMarkdownHtml(text);
      } catch {
        return null;
      }
    },
  );

  return (
    <div class="h-full min-h-0 overflow-auto">
      <Show
        when={props.kind === "html"}
        fallback={
          <Show
            when={html() !== undefined && html() !== null}
            fallback={<pre class="whitespace-pre-wrap p-3 font-mono text-[11px]">{props.text}</pre>}
          >
            <div class="pv-github-readme w-full px-4 pb-6 pt-2">
              <article class="markdown-body !bg-transparent" innerHTML={html()!} />
            </div>
          </Show>
        }
      >
        <iframe
          title="HTML preview"
          sandbox=""
          srcdoc={props.text}
          class="h-full min-h-[300px] w-full border-0 bg-white"
        />
      </Show>
    </div>
  );
}
