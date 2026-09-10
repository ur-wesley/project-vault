import { createEffect, createSignal, type Component, type JSX, Show } from "solid-js";
import { cn } from "~/lib/utils";
import { loadPluginIcon, pluginIconToSvgString } from "~/lib/plugin-icon";

export const PluginIcon: Component<{
  icon?: string;
  class?: string;
  style?: JSX.CSSProperties;
  onClick?: (event: MouseEvent) => void;
}> = (props) => {
  const [svg, setSvg] = createSignal<string | null>(null);

  createEffect(() => {
    const icon = props.icon?.trim();
    if (!icon) {
      setSvg(null);
      return;
    }

    let cancelled = false;
    setSvg(null);

    void loadPluginIcon(icon).then((data) => {
      if (cancelled) return;
      setSvg(data ? pluginIconToSvgString(data) : null);
    });

    return () => {
      cancelled = true;
    };
  });

  return (
    <Show when={svg()}>
      {(html) => (
        <span
          class={cn(
            "inline-flex shrink-0 align-middle [&>svg]:h-full [&>svg]:w-full",
            props.class,
          )}
          style={props.style}
          onClick={props.onClick}
          innerHTML={html()}
          aria-hidden
        />
      )}
    </Show>
  );
};
