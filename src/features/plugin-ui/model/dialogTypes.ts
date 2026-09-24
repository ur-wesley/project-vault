/** Shared payload types for the plugin-UI dialogs. (Moved verbatim from PluginUiBridge.) */

import type { useI18n } from "~/lib/i18n-context";

/** i18n function threaded through the dialogs (mirrors `useI18n().t`). */
export type TFunction = ReturnType<typeof useI18n>["t"];

export interface BridgeQuickPickItem {
  id: string;
  label: string;
  detail?: string;
  icon?: string;
  filePath?: string;
  lineNumber?: number;
}

export interface BridgeQuickPickOptions {
  id: string;
  title: string;
  items: BridgeQuickPickItem[];
  fuzzy?: boolean;
  preview?: boolean;
}

export interface FormField {
  id: string;
  label: string;
  fieldType: "text" | "number" | "boolean" | "select" | "textarea";
  placeholder?: string;
  defaultValue?: any;
  options?: { id: string; label: string }[];
  required?: boolean;
  pattern?: string;
  validationMessage?: string;
  min?: number;
  max?: number;
  step?: number;
}

export interface InputBoxState {
  id: string;
  title: string;
  placeholder?: string;
}

export interface MarkdownDialogState {
  pluginId: string;
  title: string;
  content: string;
}

export interface FormDialogState {
  id: string;
  title: string;
  fields: FormField[];
}

export interface DeepLinkInstallState {
  repo: string;
  branch?: string;
  tag?: string;
  commit?: string;
}
