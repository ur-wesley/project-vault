import * as i18n from "@solid-primitives/i18n";
import { createContext, useContext, type ParentComponent } from "solid-js";
import en from "~/messages/en.json";

const flatEn = i18n.flatten(en as i18n.BaseRecordDict);
type FlatMessages = typeof flatEn;

const I18nCtx = createContext<{ t: i18n.Translator<FlatMessages> }>();

export const I18nProvider: ParentComponent = (props) => {
  const t = i18n.translator(() => flatEn, i18n.resolveTemplate);
  return <I18nCtx.Provider value={{ t }}>{props.children}</I18nCtx.Provider>;
};

export function useI18n() {
  const v = useContext(I18nCtx);
  if (!v) throw new Error("I18nProvider missing");
  return v;
}
