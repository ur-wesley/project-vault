import { type Component } from "solid-js";
import { cn } from "~/lib/utils";

export type LabelBadgeProps = Readonly<{
  label: { name: string; color: string };
  class?: string;
}>;

export const LabelBadge: Component<LabelBadgeProps> = (props) => {
  const isDark = (color: string) => {
    const r = parseInt(color.slice(0, 2), 16);
    const g = parseInt(color.slice(2, 4), 16);
    const b = parseInt(color.slice(4, 6), 16);
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luma < 128;
  };

  return (
    <span
      class={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-tight shadow-sm",
        props.class,
      )}
      style={{
        "background-color": `#${props.label.color}`,
        color: isDark(props.label.color) ? "white" : "black",
      }}
    >
      {props.label.name}
    </span>
  );
};
