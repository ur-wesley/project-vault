import * as i18n from "@solid-primitives/i18n";
import { createContext, useContext, createResource, createMemo, type ParentComponent, type Accessor } from "solid-js";
import { messages, type Locale, defaultLocale } from "~/messages";
import { getSetting } from "~/services/tauri";

const LOCALE_SETTING_KEY = "ui_locale";

const flatEn = i18n.flatten(messages.en);
type FlatMessages = typeof flatEn;

const I18nCtx = createContext<{ 
  t: i18n.Translator<FlatMessages>;
  locale: Accessor<Locale>;
  setLocale: (l: Locale) => void;
  localeCode: Accessor<string>;
}>();

export const I18nProvider: ParentComponent = (props) => {
  const [currentLocale, { mutate }] = createResource(async () => {
    const r = await getSetting(LOCALE_SETTING_KEY);
    if (r.isOk() && r.value && r.value in messages) {
      return r.value as Locale;
    }
    return defaultLocale;
  }, { initialValue: defaultLocale });

  const dict = createMemo(() => {
    const loc = currentLocale();
    return i18n.flatten(messages[loc] || messages.en);
  });

  const t = i18n.translator(dict, (str, args) => {
    if (typeof str !== "string") return str;
    if (!args) return str;
    return str.replace(/{([\w.]+)}/g, (match, key) => {
      const val = args[key];
      return val !== undefined ? String(val) : match;
    });
  });
  
  const setLocale = (l: Locale) => mutate(l);

  const localeCode = createMemo(() => {
    const l = currentLocale();
    // Map internal locale keys to standard BCP 47 codes if needed
    if (l === "en") return "en-US";
    if (l === "de") return "de-DE";
    return l;
  });

  return (
    <I18nCtx.Provider value={{ t, locale: currentLocale, setLocale, localeCode }}>
      {props.children}
    </I18nCtx.Provider>
  );
};

export function useI18n() {
  const v = useContext(I18nCtx);
  if (!v) throw new Error("I18nProvider missing");
  return v;
}
