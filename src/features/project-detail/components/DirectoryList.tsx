import { For, Show, type Component } from "solid-js";
import type { Accessor } from "solid-js";

import { formatBytes } from "~/lib/format-bytes";
import type { useI18n } from "~/lib/i18n-context";
import { getRelativePath } from "~/lib/path-utils";
import { FileIcon } from "~/components/FileIcon";
import type { FileContentModel } from "../model/useFileContent";

type T = ReturnType<typeof useI18n>["t"];

/** Human type label for a directory row: folder, "EXT File", or plain file. */
function describeChild(t: T, name: string, isDirectory: boolean): string {
  if (isDirectory) return t("projectDetail.isDirectory") || "Folder";
  const extMatch = name.match(/\.([^.]+)$/);
  if (!extMatch) return "File";
  return `${extMatch[1]!.toUpperCase()} File`;
}

/**
 * Directory view: header with breadcrumbs + file table.
 * (Extracted verbatim from FilePreview.)
 */
export const DirectoryList: Component<{
  t: T;
  path: Accessor<string | null>;
  projectRoot: Accessor<string | undefined>;
  content: FileContentModel["content"];
  onNavigate?: (path: string, isDirectory?: boolean) => void;
}> = (props) => {
  const breadcrumbs = () => {
    const p = props.path();
    const root = props.projectRoot();
    if (!p || !root) return [];

    const rel = getRelativePath(p, root);
    if (!rel) return [];

    const parts = rel.split("/");
    const result: Array<{ name: string; absPath: string }> = [];
    let currentAccum = root;

    for (const part of parts) {
      if (!part) continue;
      const separator = root.includes("\\") ? "\\" : "/";
      currentAccum = currentAccum.endsWith(separator)
        ? currentAccum + part
        : currentAccum + separator + part;
      result.push({ name: part, absPath: currentAccum });
    }
    return result;
  };

  return (
    <div class="p-6 h-full overflow-auto flex flex-col min-w-0 font-sans text-xs">
      {/* Header Section */}
      <div class="flex items-center gap-3 mb-6 shrink-0 border-b border-border/40 pb-4">
        <div class="size-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-500">
          <FileIcon name={props.path()?.split(/[\\/]/).pop() ?? ""} isDirectory class="h-6 w-6" />
        </div>
        <div class="flex flex-col min-w-0">
          <h3 class="text-sm font-semibold text-foreground/90 truncate">
            {props.path()?.split(/[\\/]/).pop()}
          </h3>
          {/* Breadcrumbs */}
          <div class="flex items-center gap-1.5 text-[11px] text-muted-foreground/60 overflow-x-auto whitespace-nowrap mt-0.5 scrollbar-none">
            <button
              type="button"
              class="hover:text-primary hover:underline font-medium cursor-pointer"
              onClick={() => props.onNavigate?.(props.projectRoot() || "", true)}
            >
              {props.projectRoot()?.split(/[\\/]/).pop() || "Root"}
            </button>
            <For each={breadcrumbs()}>
              {(crumb) => (
                <>
                  <span class="iconify mdi--chevron-right h-3 w-3 shrink-0" />
                  <button
                    type="button"
                    class="hover:text-primary hover:underline font-medium truncate max-w-[120px] cursor-pointer"
                    onClick={() => props.onNavigate?.(crumb.absPath, true)}
                  >
                    {crumb.name}
                  </button>
                </>
              )}
            </For>
          </div>
        </div>
      </div>

      {/* Directory Contents */}
      <div class="flex-1 overflow-y-auto rounded-md border border-border/40 bg-muted/5 p-1 min-h-0">
        <table class="w-full text-left text-xs border-collapse">
          <thead>
            <tr class="border-b border-border/40 text-[10px] text-muted-foreground/60 font-semibold tracking-wider uppercase">
              <th class="py-2 px-3">{props.t("projectDetail.taskEditor.name") || "Name"}</th>
              <th class="py-2 px-3">{props.t("common.status") || "Type"}</th>
              <th class="py-2 px-3 text-right">{props.t("locations.sizeColumn") || "Size"}</th>
            </tr>
          </thead>
          <tbody>
            <Show when={props.content() && props.content()!.children?.length === 0}>
              <tr>
                <td colspan={3} class="py-12 text-center text-muted-foreground italic">
                  {props.t("projectDetail.dirEmpty") || "This directory is empty."}
                </td>
              </tr>
            </Show>
            <Show when={props.content()}>
              <For each={props.content()!.children}>
                {(child) => {
                  const typeLabel = describeChild(
                    props.t,
                    child.name,
                    child.isDirectory,
                  );

                  return (
                    <tr
                      class="group hover:bg-primary/5 hover:text-primary rounded cursor-pointer transition-all duration-150 border-b border-border/10 last:border-b-0"
                      onClick={() => props.onNavigate?.(child.absPath, child.isDirectory)}
                    >
                      <td class="py-2.5 px-3 font-mono text-[11px] font-medium flex items-center gap-2 max-w-xs truncate">
                        <FileIcon
                          name={child.name}
                          isDirectory={child.isDirectory}
                          class="size-4 transition-transform group-hover:scale-110"
                        />
                        <span class="truncate">{child.name}</span>
                      </td>
                      <td class="py-2.5 px-3 text-muted-foreground/80 group-hover:text-primary/80 font-mono text-[10px]">
                        {typeLabel}
                      </td>
                      <td class="py-2.5 px-3 text-right font-mono text-[10px] text-muted-foreground/60 group-hover:text-primary/60">
                        {child.isDirectory ? "—" : formatBytes(child.size)}
                      </td>
                    </tr>
                  );
                }}
              </For>
            </Show>
          </tbody>
        </table>
      </div>
    </div>
  );
};
