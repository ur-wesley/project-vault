import type { Component } from "solid-js";

import { Button } from "~/components/ui/button";
import { DialogShell } from "~/components/DialogShell";
import { TextField, TextFieldInput, TextFieldLabel } from "~/components/ui/text-field";
import type { TFunction } from "../model/dialogTypes";
import type { createInputBoxModel } from "../model/useInputBox";

/**
 * Input-box dialog on the shared DialogShell.
 * (Extracted verbatim from PluginUiBridge.)
 */
export const InputBoxDialog: Component<{
  t: TFunction;
  model: ReturnType<typeof createInputBoxModel>;
}> = (props) => {
  const { t, model } = props;

  return (
    <DialogShell
      open={!!model.inputBox()}
      onClose={() => model.resolveInput(null)}
      title={model.inputBox()?.title ?? ""}
      footer={
        <>
          <Button variant="ghost" onClick={() => model.resolveInput(null)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => model.resolveInput(model.inputValue())}>
            {t("settings.pluginsUiOk")}
          </Button>
        </>
      }
    >
      <div class="py-4">
        <TextField value={model.inputValue()} onChange={model.setInputValue}>
          <TextFieldLabel class="sr-only">{t("settings.pluginsUiInputLabel")}</TextFieldLabel>
          <TextFieldInput
            placeholder={model.inputBox()?.placeholder}
            onKeyDown={(e) => {
              if (e.key === "Enter") model.resolveInput(model.inputValue());
              if (e.key === "Escape") model.resolveInput(null);
            }}
            autofocus
          />
        </TextField>
      </div>
    </DialogShell>
  );
};
