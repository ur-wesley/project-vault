import { Show, type Component } from "solid-js";

import type { FileContentModel } from "../model/useFileContent";

/**
 * Code view: highlighted HTML or plain-text fallback.
 * (Extracted verbatim from FilePreview.)
 */
export const CodeView: Component<{
  content: FileContentModel["content"];
}> = (props) => {
  return (
    <div class="text-[11px] font-mono">
      <Show
        when={props.content()?.html}
        fallback={<pre class="p-3 whitespace-pre-wrap">{props.content()?.text}</pre>}
      >
        <div class="shiki-container" innerHTML={props.content()?.html ?? ""} />
      </Show>
    </div>
  );
};
