import { createSignal, onCleanup, onMount, Show, For } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { TextField, TextFieldInput, TextFieldLabel } from "~/components/ui/text-field";
import { Command, CommandInput, CommandList, CommandItem, CommandGroup, CommandEmpty } from "~/components/ui/command";

export function PluginUiBridge() {
  const [inputBox, setInputBox] = createSignal<{ id: string; title: string; placeholder?: string } | null>(null);
  const [quickPick, setQuickPick] = createSignal<{ id: string; title: string; items: { id: string; label: string; detail?: string; icon?: string }[] } | null>(null);
  
  const [inputValue, setInputValue] = createSignal("");

  onMount(async () => {
    const unlistenInput = await listen<{ id: string; title: string; placeholder?: string }>("plugin:show-input", (event) => {
      setInputBox({ id: event.payload.id, title: event.payload.title, placeholder: event.payload.placeholder });
      setInputValue("");
    });

    const unlistenQuickPick = await listen<{ id: string; title: string; items: any[] }>("plugin:show-quick-pick", (event) => {
      setQuickPick({ id: event.payload.id, title: event.payload.title, items: event.payload.items });
    });

    onCleanup(() => {
      unlistenInput();
      unlistenQuickPick();
    });
  });

  const resolveInput = async (value: string | null) => {
    const current = inputBox();
    if (!current) return;
    await invoke("resolve_plugin_ui", { id: current.id, value });
    setInputBox(null);
  };

  const resolveQuickPick = async (value: string | null) => {
    const current = quickPick();
    if (!current) return;
    await invoke("resolve_plugin_ui", { id: current.id, value });
    setQuickPick(null);
  };

  return (
    <>
      {/* Input Box Dialog */}
      <Dialog open={!!inputBox()} onOpenChange={(open) => !open && resolveInput(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{inputBox()?.title}</DialogTitle>
          </DialogHeader>
          <div class="py-4">
            <TextField value={inputValue()} onChange={setInputValue}>
              <TextFieldLabel class="sr-only">Input</TextFieldLabel>
              <TextFieldInput 
                placeholder={inputBox()?.placeholder} 
                onKeyDown={(e) => {
                  if (e.key === "Enter") resolveInput(inputValue());
                  if (e.key === "Escape") resolveInput(null);
                }}
                autofocus
              />
            </TextField>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => resolveInput(null)}>Cancel</Button>
            <Button onClick={() => resolveInput(inputValue())}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick Pick Dialog */}
      <Dialog open={!!quickPick()} onOpenChange={(open) => !open && resolveQuickPick(null)}>
        <DialogContent class="p-0 sm:max-w-[550px]">
          <Command class="rounded-lg border shadow-md">
            <CommandInput 
                placeholder={quickPick()?.title} 
                autofocus
            />
            <CommandList>
              <CommandEmpty>No results found.</CommandEmpty>
              <CommandGroup heading={quickPick()?.title}>
                <For each={quickPick()?.items}>
                  {(item) => (
                    <CommandItem 
                      onSelect={() => resolveQuickPick(item.id)}
                      class="flex items-center gap-2 px-4 py-2"
                    >
                      <Show when={item.icon}>
                        <span class={`iconify ${item.icon} size-4 opacity-70`} />
                      </Show>
                      <div class="flex flex-col">
                        <span class="text-sm font-medium">{item.label}</span>
                        <Show when={item.detail}>
                          <span class="text-xs text-muted-foreground">{item.detail}</span>
                        </Show>
                      </div>
                    </CommandItem>
                  )}
                </For>
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
