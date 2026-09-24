import { createSignal, onCleanup, onMount } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

import type { FormDialogState, FormField } from "./dialogTypes";

/**
 * Dynamic-form dialog domain: state, validation, resolve, show-form
 * subscription. (Extracted verbatim from PluginUiBridge.)
 */
export function createDynamicFormModel() {
  const [formDialog, setFormDialog] = createSignal<FormDialogState | null>(null);
  const [formValues, setFormValues] = createSignal<Record<string, any>>({});
  const [formErrors, setFormErrors] = createSignal<Record<string, string>>({});

  const validateForm = () => {
    const errors: Record<string, string> = {};
    const values = formValues();
    const dialog = formDialog();
    if (!dialog) return false;

    for (const field of dialog.fields) {
      const val = values[field.id];

      // Required check
      if (field.required) {
        if (val == null || val === "" || (field.fieldType === "boolean" && val === false)) {
          errors[field.id] = `${field.label} is required`;
          continue;
        }
      }

      // Pattern check (Regex)
      if (field.pattern && (field.fieldType === "text" || field.fieldType === "textarea")) {
        const strVal = String(val || "");
        if (strVal) {
          try {
            const rx = new RegExp(field.pattern);
            if (!rx.test(strVal)) {
              errors[field.id] = field.validationMessage || `${field.label} is invalid`;
              continue;
            }
          } catch {
            // ignore invalid regexes
          }
        }
      }

      // Number checks
      if (field.fieldType === "number" && val != null && val !== "") {
        const num = Number(val);
        if (Number.isNaN(num)) {
          errors[field.id] = "Must be a number";
          continue;
        }
        if (field.min !== undefined && num < field.min) {
          errors[field.id] = `Min value is ${field.min}`;
          continue;
        }
        if (field.max !== undefined && num > field.max) {
          errors[field.id] = `Max value is ${field.max}`;
          continue;
        }
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const resolveForm = async (submit: boolean) => {
    const current = formDialog();
    if (!current) return;
    if (submit) {
      if (!validateForm()) return; // Stop if invalid
      await invoke("resolve_plugin_ui", { id: current.id, value: formValues() });
    } else {
      await invoke("resolve_plugin_ui", { id: current.id, value: null });
    }
    setFormDialog(null);
    setFormErrors({});
  };

  onMount(() => {
    const unlistens: (() => void)[] = [];
    void (async () => {
      unlistens.push(
        await listen<[string, { title: string; fields: FormField[] }]>(
          "plugin:show-form",
          (event) => {
            const [id, options] = event.payload;
            const initialValues: Record<string, unknown> = {};
            for (const f of options.fields) {
              if (f.defaultValue !== undefined) {
                initialValues[f.id] = f.defaultValue;
              } else if (f.fieldType === "boolean") {
                initialValues[f.id] = false;
              } else {
                initialValues[f.id] = "";
              }
            }
            setFormValues(initialValues);
            setFormErrors({});
            setFormDialog({ id, title: options.title, fields: options.fields });
          },
        ),
      );
    })();
    onCleanup(() => {
      for (const fn of unlistens) fn();
    });
  });

  return { formDialog, formValues, setFormValues, formErrors, resolveForm };
}
