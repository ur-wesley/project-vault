import { type Component, For, Show, createSignal } from "solid-js";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "~/components/ui/tooltip";
import { Separator } from "~/components/ui/separator";
import { useI18n } from "~/lib/i18n-context";
import type { AnnotationTool } from "../lib/canvas-tools";

interface AnnotationToolbarProps {
  activeTool: AnnotationTool;
  onToolChange: (tool: AnnotationTool) => void;
  color: string;
  onColorChange: (color: string) => void;
  strokeWidth: number;
  onStrokeWidthChange: (width: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#ffffff",
  "#000000",
];

const AnnotationToolbar: Component<AnnotationToolbarProps> = (props) => {
  const { t } = useI18n();
  const [showColorPicker, setShowColorPicker] = createSignal(false);

  const tools = () => [
    { tool: "select" as const, icon: "iconify mdi--cursor-default", label: t("screenshot.toolSelect") },
    { tool: "arrow" as const, icon: "iconify mdi--arrow-top-right", label: t("screenshot.toolArrow") },
    { tool: "rectangle" as const, icon: "iconify mdi--rectangle-outline", label: t("screenshot.toolRectangle") },
    { tool: "freehand" as const, icon: "iconify mdi--draw", label: t("screenshot.toolDraw") },
    { tool: "text" as const, icon: "iconify mdi--format-text", label: t("screenshot.toolText") },
    { tool: "highlight" as const, icon: "iconify mdi--marker", label: t("screenshot.toolHighlight") },
  ];

  return (
    <div class="flex items-center gap-1 rounded-lg border border-border bg-background/95 px-3 py-2 shadow-lg backdrop-blur-sm">
      <For each={tools()}>
        {(item) => (
          <Tooltip>
            <TooltipTrigger
              as={Button}
              variant={props.activeTool === item.tool ? "default" : "ghost"}
              size="icon"
              class="size-8"
              onClick={() => props.onToolChange(item.tool)}
            >
              <span class={`${item.icon} text-lg`} />
            </TooltipTrigger>
            <TooltipContent>{item.label}</TooltipContent>
          </Tooltip>
        )}
      </For>

      <Separator orientation="vertical" class="mx-1 h-8" />

      <div class="relative">
        <Tooltip>
          <TooltipTrigger
            as={Button}
            variant="ghost"
            size="icon"
            class="size-8"
            onClick={() => setShowColorPicker(!showColorPicker())}
          >
            <span
              class="block size-5 rounded-full border border-border"
              style={{ "background-color": props.color }}
            />
          </TooltipTrigger>
          <TooltipContent>{t("screenshot.color")}</TooltipContent>
        </Tooltip>
        <Show when={showColorPicker()}>
          <div class="absolute bottom-10 left-1/2 z-50 flex flex-wrap gap-1 rounded-lg border border-border bg-background p-2 shadow-lg" style={{ width: "120px", transform: "translateX(-50%)" }}>
            <For each={COLORS}>
              {(c) => (
                <button
                  type="button"
                  class="size-6 rounded-full border border-border transition-transform hover:scale-110"
                  classList={{ "ring-2 ring-primary ring-offset-2 ring-offset-background": props.color === c }}
                  style={{ "background-color": c }}
                  onClick={() => {
                    props.onColorChange(c);
                    setShowColorPicker(false);
                  }}
                />
              )}
            </For>
          </div>
        </Show>
      </div>

      <Separator orientation="vertical" class="mx-1 h-8" />

      <div class="flex items-center gap-1">
        <span class="text-[10px] text-muted-foreground w-6 text-center">{props.strokeWidth}px</span>
        <input
          type="range"
          min="1"
          max="10"
          value={props.strokeWidth}
          onInput={(e) => props.onStrokeWidthChange(Number.parseInt(e.currentTarget.value))}
          class="w-20 cursor-pointer accent-primary"
        />
      </div>

      <Separator orientation="vertical" class="mx-1 h-8" />

      <Tooltip>
        <TooltipTrigger
          as={Button}
          variant="ghost"
          size="icon"
          class="size-8"
          onClick={props.onUndo}
          disabled={!props.canUndo}
        >
          <span class="iconify mdi--undo text-lg" />
        </TooltipTrigger>
        <TooltipContent>{t("screenshot.undo")}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          as={Button}
          variant="ghost"
          size="icon"
          class="size-8"
          onClick={props.onRedo}
          disabled={!props.canRedo}
        >
          <span class="iconify mdi--redo text-lg" />
        </TooltipTrigger>
        <TooltipContent>{t("screenshot.redo")}</TooltipContent>
      </Tooltip>
    </div>
  );
};

export default AnnotationToolbar;
