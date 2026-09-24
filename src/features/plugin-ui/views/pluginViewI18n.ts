import { useI18n } from "~/lib/i18n-context";

export type PluginViewT = (key: string, params?: Record<string, unknown>) => unknown;

const enFallback: Record<string, string> = {
  "pluginView.searchPlaceholder": "Search…",
  "pluginView.noResults": "No results",
  "pluginView.prev": "Prev",
  "pluginView.next": "Next",
  "pluginView.pageOf": "Page {current} of {total}",
  "pluginView.unsupportedView": "Unsupported view",
  "pluginView.formNotSupported": 'View kind "form" is not supported yet',
};

function format(template: string, params?: Record<string, unknown>): string {
  if (!params) return template;
  return template.replace(/{([\w.]+)}/g, (match, key) => {
    const val = params[key];
    return val !== undefined ? String(val) : match;
  });
}

/** Translator for plugin-view chrome that works without I18nProvider
 *  (tests, isolated renders) by falling back to English defaults. */
export function usePluginViewT(): PluginViewT {
  try {
    const { t } = useI18n();
    return t as unknown as PluginViewT;
  } catch {
    return ((key: string, params?: Record<string, unknown>) =>
      format(enFallback[key] ?? key, params)) as PluginViewT;
  }
}
