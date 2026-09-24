import { Show, type Component } from "solid-js";

import { Button } from "~/components/ui/button";
import { DialogShell } from "~/components/DialogShell";
import { IssueMarkdown } from "~/features/project-detail/components/IssueMarkdown";
import type { TFunction } from "../model/dialogTypes";
import type { createMarkdownDialogModel } from "../model/useMarkdownDialog";

/**
 * Markdown-reader dialog on the shared DialogShell.
 * (Extracted verbatim from PluginUiBridge.)
 */
export const MarkdownDialog: Component<{
  t: TFunction;
  model: ReturnType<typeof createMarkdownDialogModel>;
}> = (props) => {
  const { t, model } = props;

  return (
    <DialogShell
      open={!!model.markdownDialog()}
      onClose={() => model.closeMarkdown("close-event")}
      title={model.markdownDialog()?.title ?? ""}
      contentClass="max-h-[85vh] overflow-y-auto overflow-x-hidden sm:max-w-[750px]"
      footer={<Button onClick={() => model.closeMarkdown()}>{t("common.close") || "Close"}</Button>}
    >
      <div class="py-4">
        <Show when={model.markdownDialog()}>
          {(dialog) => (
            <div class="mx-auto w-full max-w-3xl prose prose-sm dark:prose-invert prose-headings:m-0 pv-markdown-dialog-content">
              <IssueMarkdown content={dialog().content} />
            </div>
          )}
        </Show>
      </div>
    </DialogShell>
  );
};
