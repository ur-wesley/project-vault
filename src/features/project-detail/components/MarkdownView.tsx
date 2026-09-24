import { Show, type Component } from "solid-js";
import type { Accessor } from "solid-js";

import { CodeView } from "./CodeView";
import type { FileContentModel } from "../model/useFileContent";

/**
 * Markdown view: rendered preview or source code.
 * (Extracted verbatim from FilePreview.)
 */
export const MarkdownView: Component<{
  content: FileContentModel["content"];
  viewMode: Accessor<"preview" | "code">;
}> = (props) => {
  return (
    <Show
      when={props.content()?.isMarkdown && props.viewMode() === "preview"}
      fallback={<CodeView content={props.content} />}
    >
      <div class="pv-github-readme w-full pt-2 pb-6 px-4">
        <article class="markdown-body !bg-transparent" innerHTML={props.content()?.markdownHtml ?? ""} />
      </div>
    </Show>
  );
};
