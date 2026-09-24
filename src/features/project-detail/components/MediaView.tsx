import { Show, type Component } from "solid-js";
import type { Accessor } from "solid-js";
import { openPath } from "@tauri-apps/plugin-opener";

import { formatBytes } from "~/lib/format-bytes";
import type { useI18n } from "~/lib/i18n-context";
import type { FileContentModel } from "../model/useFileContent";

type T = ReturnType<typeof useI18n>["t"];

/**
 * Media view: image, PDF, or too-large fallback with open-externally.
 * (Extracted verbatim from FilePreview.)
 */
export const MediaView: Component<{
  t: T;
  path: Accessor<string | null>;
  content: FileContentModel["content"];
}> = (props) => {
  const onOpenExternally = async () => {
    const path = props.path();
    if (!path) return;
    try {
      await openPath(path);
    } catch (e) {
      console.error("Failed to open file externally:", e);
    }
  };

  return (
    <Show
      when={props.content()?.mediaTooLarge}
      fallback={
        <Show
          when={props.content()?.mediaKind === "image" && props.content()?.mediaUrl}
          fallback={
            <Show
              when={props.content()?.mediaKind === "pdf" && props.content()?.mediaUrl}
              fallback={<></>}
            >
              <embed
                src={props.content()?.mediaUrl ?? ""}
                type="application/pdf"
                class="w-full h-full min-h-0"
              />
            </Show>
          }
        >
          <div class="flex h-full min-h-0 items-center justify-center p-4">
            <img
              src={props.content()?.mediaUrl ?? ""}
              alt=""
              class="max-h-full max-w-full object-contain"
            />
          </div>
        </Show>
      }
    >
      <div class="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <p class="text-[11px] text-muted-foreground">
          {
            props.t("projectDetail.fileMediaTooLarge", {
              size: formatBytes(props.content()?.fileSize ?? 0),
            }) as string
          }
        </p>
        <button
          type="button"
          class="rounded-md border border-border/40 bg-muted/30 px-3 py-1.5 text-[11px] font-medium text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
          onClick={onOpenExternally}
        >
          {props.t("projectDetail.openExternally") as string}
        </button>
      </div>
    </Show>
  );
};
