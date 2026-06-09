import { createEffect, createSignal, type Component } from "solid-js";
import { cn } from "~/lib/utils";
import {
  FOLDER_SENTINEL,
  fileIconifyName,
  iconToSvgString,
  loadFileIcon,
} from "~/lib/file-icon";

const FALLBACK_FILE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" opacity="0.35"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm-1 1.5L18.5 9H13z"/></svg>';

const FALLBACK_FOLDER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" opacity="0.35"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7l-2-2z"/></svg>';

export const FileIcon: Component<{
  name: string;
  isDirectory?: boolean;
  class?: string;
}> = (props) => {
  const [svg, setSvg] = createSignal<string | null>(null);

  createEffect(() => {
    const n = props.name;
    const dir = props.isDirectory ?? false;
    let cancelled = false;
    setSvg(null);

    const resolved = fileIconifyName(n, dir);
    if (resolved === FOLDER_SENTINEL) {
      setSvg(FALLBACK_FOLDER_SVG);
      return;
    }

    void loadFileIcon(n, dir).then((icon) => {
      if (cancelled) return;
      if (icon) {
        setSvg(iconToSvgString(icon));
      } else {
        setSvg(dir ? FALLBACK_FOLDER_SVG : FALLBACK_FILE_SVG);
      }
    });

    return () => {
      cancelled = true;
    };
  });

  return (
    <span
      class={cn(
        "inline-flex shrink-0 align-middle [&>svg]:h-full [&>svg]:w-full",
        props.class,
      )}
      innerHTML={svg() ?? (props.isDirectory ? FALLBACK_FOLDER_SVG : FALLBACK_FILE_SVG)}
      aria-hidden
    />
  );
};
