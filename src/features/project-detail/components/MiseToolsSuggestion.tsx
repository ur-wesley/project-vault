import { Show, For, createSignal, type Component } from "solid-js";
import { Button } from "~/components/ui/button";
import { useI18n } from "~/lib/i18n-context";
import { cn } from "~/lib/utils";
import type { MiseToolSuggestionDto } from "~/types/dto";

export const MiseToolsSuggestion: Component<{
  suggestions: MiseToolSuggestionDto[];
  isLoading: boolean;
  isPending: boolean;
  onPin: (tools: MiseToolSuggestionDto[]) => void;
  onDismiss: () => void;
}> = (props) => {
  const { t } = useI18n();
  const [selected, setSelected] = createSignal<Set<string>>(new Set());

  const toggleTool = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const allSelected = () => selected().size === props.suggestions.length;

  const toggleSelectAll = () => {
    if (allSelected()) {
      setSelected(new Set());
    } else {
      setSelected(new Set(props.suggestions.map((s) => s.name)));
    }
  };

  const selectedTools = () =>
    props.suggestions.filter((s) => selected().has(s.name));

  return (
    <Show when={props.suggestions.length > 0}>
      <div class="rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
        <div>
          <div class="flex items-center gap-1.5">
            <span class="iconify mdi--tools text-primary/80 size-3.5" />
            <p class="text-[11px] font-bold text-primary">
              {t("projectDetail.miseSuggestionsTitle") as string}
            </p>
          </div>
          <p class="mt-0.5 text-[10px] text-muted-foreground">
            {t("projectDetail.miseSuggestionsDesc") as string}
          </p>
          <div class="mt-1.5 flex flex-wrap gap-1.5">
            <For each={props.suggestions}>
              {(tool) => (
                <button
                  type="button"
                  class={cn(
                    "flex items-center gap-1 rounded border px-2 py-0.5 text-[9px] font-medium transition-all",
                    selected().has(tool.name)
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border/40 bg-background/50 text-muted-foreground hover:border-primary/30 hover:text-foreground",
                  )}
                  onClick={() => toggleTool(tool.name)}
                  title={tool.reason}
                >
                  <span
                    class={cn(
                      "iconify size-2.5",
                      selected().has(tool.name)
                        ? "mdi--check-circle"
                        : "mdi--checkbox-blank-circle-outline",
                    )}
                  />
                  <span class="font-mono font-bold">{tool.name}</span>
                  <span class="text-muted-foreground/70">{tool.version}</span>
                </button>
              )}
            </For>
          </div>
        </div>
        <div class="mt-2 flex items-center justify-end gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="h-5 text-[9px] text-muted-foreground hover:text-destructive px-1.5"
            onClick={props.onDismiss}
          >
            {t("common.dismiss") as string}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="h-5 text-[9px] text-muted-foreground hover:text-foreground px-1.5"
            onClick={toggleSelectAll}
          >
            {allSelected() ? (t("common.deselectAll") as string) : (t("common.selectAll") as string)}
          </Button>
          <Button
            type="button"
            size="sm"
            class="h-7 gap-1 text-[9px] font-bold px-2"
            disabled={selectedTools().length === 0 || props.isPending}
            onClick={() => props.onPin(selectedTools())}
          >
            <Show
              when={props.isPending}
              fallback={<span class="iconify mdi--pin-outline size-3" />}
            >
              <span class="iconify mdi--loading animate-spin size-3" />
            </Show>
            {t("projectDetail.misePinSelected") as string}
          </Button>
        </div>
      </div>
    </Show>
  );
};
