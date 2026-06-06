import { Show, createResource, createSignal, type Component } from "solid-js";
import { createHighlighter } from "shiki";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { IssueMarkdown } from "~/features/project-detail/components/IssueMarkdown";
import creatingPluginsMd from "../../../../docs/creating-plugins.md?raw";
import pluginsMd from "../../../../docs/plugins.md?raw";
import vaultLuau from "../../../../src-tauri/lua-sdk/vault.luau?raw";

type DocTab = "creating" | "api" | "vault";

const DOC_FILES: Record<DocTab, string> = {
  creating: creatingPluginsMd,
  api: pluginsMd,
  vault: vaultLuau,
};

export type PluginDocsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  t: (key: string, params?: Record<string, unknown>) => string;
};

export const PluginDocsDialog: Component<PluginDocsDialogProps> = (props) => {
  const [docTab, setDocTab] = createSignal<DocTab>("creating");
  const [copied, setCopied] = createSignal(false);

  const [highlighter] = createResource(async () =>
    createHighlighter({
      themes: ["github-dark"],
      langs: ["luau"],
    }),
  );

  const [vaultHtml] = createResource(
    () => highlighter(),
    (hl) => {
      if (!hl) return null;
      return hl.codeToHtml(vaultLuau, {
        lang: "luau",
        theme: "github-dark",
        transformers: [
          {
            line(node, line) {
              node.properties["data-line"] = line;
            },
          },
        ],
      });
    },
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(DOC_FILES[docTab()]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy doc: ", err);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent class="flex max-h-[85vh] flex-col gap-0 overflow-hidden sm:max-w-[900px]">
        <DialogHeader>
          <DialogTitle>{props.t("pluginsDashboard.docsDialogTitle")}</DialogTitle>
        </DialogHeader>

        <Tabs
          value={docTab()}
          onChange={(v) => setDocTab(v as DocTab)}
          class="flex min-h-0 flex-1 flex-col gap-3"
        >
          <div class="flex shrink-0 flex-wrap items-center justify-between gap-2">
            <TabsList class="h-auto flex-1 flex-wrap justify-start gap-1 bg-muted/30 p-0.5">
              <TabsTrigger value="creating" class="text-xs">
                {props.t("pluginsDashboard.docsTabCreating")}
              </TabsTrigger>
              <TabsTrigger value="api" class="text-xs">
                {props.t("pluginsDashboard.docsTabApi")}
              </TabsTrigger>
              <TabsTrigger value="vault" class="text-xs font-mono">
                {props.t("pluginsDashboard.docsTabVault")}
              </TabsTrigger>
            </TabsList>
            <Button
              size="sm"
              variant="outline"
              class="h-7 shrink-0 gap-1.5 text-[11px] font-bold"
              onClick={() => void handleCopy()}
            >
              <Show
                when={copied()}
                fallback={<span class="iconify mdi--content-copy size-3.5" aria-hidden="true" />}
              >
                <span class="iconify mdi--check size-3.5 text-green-500" aria-hidden="true" />
              </Show>
              {copied()
                ? props.t("pluginsDashboard.docsCopied")
                : props.t("pluginsDashboard.docsCopy")}
            </Button>
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">
            <TabsContent value="creating" class="mt-0 outline-none">
              <div class="pv-markdown-dialog-content mx-auto w-full max-w-3xl pb-2">
                <IssueMarkdown content={creatingPluginsMd} />
              </div>
            </TabsContent>
            <TabsContent value="api" class="mt-0 outline-none">
              <div class="pv-markdown-dialog-content mx-auto w-full max-w-3xl pb-2">
                <IssueMarkdown content={pluginsMd} />
              </div>
            </TabsContent>
            <TabsContent value="vault" class="mt-0 outline-none">
              <div class="pv-markdown-dialog-content mx-auto w-full pb-2">
                <Show
                  when={vaultHtml()}
                  fallback={
                    <p class="animate-pulse px-1 text-xs text-muted-foreground">
                      {props.t("common.rendering")}
                    </p>
                  }
                >
                  <div class="shiki-container rounded-md border border-border/40 text-[11px] font-mono">
                    <div innerHTML={vaultHtml()!} />
                  </div>
                </Show>
              </div>
            </TabsContent>
          </div>
        </Tabs>

        <DialogFooter class="shrink-0 border-t border-border/40 pt-3">
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            {props.t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
