import en from "./en";
import de from "./de";

export const messages = {
  en,
  de,
};

export type Locale = keyof typeof messages;
export const locales = Object.keys(messages) as Locale[];
export const defaultLocale: Locale = "en";
