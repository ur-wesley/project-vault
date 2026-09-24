import { For, Show, type Component } from "solid-js";

import { Button } from "~/components/ui/button";
import { DialogShell } from "~/components/DialogShell";
import type { TFunction } from "../model/dialogTypes";
import type { FormField } from "../model/dialogTypes";
import type { createDynamicFormModel } from "../model/useDynamicForm";

/** Number fields stay empty-string until typed; everything else passes through. */
function toFieldValue(field: FormField, raw: string): string | number {
  if (field.fieldType !== "number") return raw;
  if (raw === "") return "";
  return Number(raw);
}

/**
 * Dynamic-form dialog on the shared DialogShell.
 * (Extracted verbatim from PluginUiBridge.)
 */
export const FormDialog: Component<{
  t: TFunction;
  model: ReturnType<typeof createDynamicFormModel>;
}> = (props) => {
  const { t, model } = props;

  return (
    <DialogShell
      open={!!model.formDialog()}
      onClose={() => model.resolveForm(false)}
      title={model.formDialog()?.title ?? ""}
      contentClass="sm:max-w-[500px]"
      footer={
        <>
          <Button variant="ghost" onClick={() => model.resolveForm(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => model.resolveForm(true)}>{t("settings.pluginsUiOk")}</Button>
        </>
      }
    >
      <div class="px-1 py-4 space-y-4 max-h-[60vh] overflow-y-auto pr-2 scrollbar-thin">
        <For each={model.formDialog()?.fields}>
          {(field) => (
            <div class="flex flex-col gap-1.5">
              <Show when={field.fieldType !== "boolean"}>
                <label class="text-xs font-bold tracking-tight text-foreground/80">
                  {field.label}
                  <Show when={field.required}>
                    <span class="text-destructive ml-0.5">*</span>
                  </Show>
                </label>
              </Show>

              <Show when={field.fieldType === "text" || field.fieldType === "number"}>
                <input
                  type={field.fieldType === "number" ? "number" : "text"}
                  placeholder={field.placeholder}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={model.formValues()[field.id] ?? ""}
                  onInput={(e) =>
                    model.setFormValues((prev) => ({
                      ...prev,
                      [field.id]: toFieldValue(field, e.currentTarget.value),
                    }))
                  }
                  class={`flex h-9 w-full rounded-md border bg-background px-3 py-1.5 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary ${
                    model.formErrors()[field.id]
                      ? "border-destructive focus-visible:ring-destructive"
                      : "border-border/60"
                  }`}
                />
              </Show>

              <Show when={field.fieldType === "textarea"}>
                <textarea
                  placeholder={field.placeholder}
                  value={model.formValues()[field.id] ?? ""}
                  onInput={(e) =>
                    model.setFormValues((prev) => ({ ...prev, [field.id]: e.currentTarget.value }))
                  }
                  class={`flex min-h-[80px] w-full rounded-md border bg-background px-3 py-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary ${
                    model.formErrors()[field.id]
                      ? "border-destructive focus-visible:ring-destructive"
                      : "border-border/60"
                  }`}
                />
              </Show>

              <Show when={field.fieldType === "select"}>
                <select
                  value={model.formValues()[field.id] ?? ""}
                  onChange={(e) =>
                    model.setFormValues((prev) => ({ ...prev, [field.id]: e.target.value }))
                  }
                  class="flex h-9 w-full rounded-md border border-border/60 bg-background px-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                >
                  <For each={field.options}>
                    {(opt) => (
                      <option value={opt.id} class="bg-background text-foreground text-xs">
                        {opt.label}
                      </option>
                    )}
                  </For>
                </select>
              </Show>

              <Show when={field.fieldType === "boolean"}>
                <label class="flex items-center gap-2 text-xs font-bold text-foreground/80 cursor-pointer py-1.5">
                  <input
                    type="checkbox"
                    checked={!!model.formValues()[field.id]}
                    onChange={(e) =>
                      model.setFormValues((prev) => ({ ...prev, [field.id]: e.target.checked }))
                    }
                    class="rounded border border-border/60 bg-background text-primary focus:ring-primary size-4"
                  />
                  <span>{field.label}</span>
                  <Show when={field.required}>
                    <span class="text-destructive ml-0.5">*</span>
                  </Show>
                </label>
              </Show>

              <Show when={model.formErrors()[field.id]}>
                <span class="text-[10px] font-medium text-destructive">
                  {model.formErrors()[field.id]}
                </span>
              </Show>
            </div>
          )}
        </For>
      </div>
    </DialogShell>
  );
};
