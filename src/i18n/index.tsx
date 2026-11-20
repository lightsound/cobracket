import { isServer } from "@solidjs/web";
import { createContext, createSignal, useContext, type Accessor, type ParentProps } from "solid-js";
import { en, type MessageKey } from "./en";
import { ja } from "./ja";

/**
 * @public
 */
export type Locale = "en" | "ja";

/**
 * @public
 */
export type { MessageKey } from "./en";

const STORAGE_KEY = "cobracket:locale";

function readStoredLocale(): string | null {
  if (isServer) return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function defaultLocale(): Locale {
  if (isServer) return "en";
  return navigator.language.toLowerCase().startsWith("ja") ? "ja" : "en";
}

function storedLocale(): Locale {
  const value = readStoredLocale();
  if (value === "en" || value === "ja") return value;
  return defaultLocale();
}

const dictionaries: Record<Locale, Record<MessageKey, string>> = { en, ja };

/** @public */
export interface I18n {
  locale: Accessor<Locale>;
  setLocale: (next: Locale) => void;
  /**
   * Translate a message key in the current locale. `{name}` placeholders are
   * replaced from `params`. Reading it inside JSX (or any tracking scope)
   * subscribes to locale changes.
   */
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

function createI18n(): I18n {
  const [locale, setLocaleSignal] = createSignal<Locale>(storedLocale());

  function setLocale(next: Locale): void {
    setLocaleSignal(next);
    if (isServer) return;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  }

  function t(key: MessageKey, params?: Record<string, string | number>): string {
    const template = dictionaries[locale()][key];
    return params === undefined
      ? template
      : template.replace(/\{(\w+)\}/g, (whole, name: string) =>
          name in params ? String(params[name]) : whole,
        );
  }

  return { locale, setLocale, t };
}

const I18nContext = createContext<I18n>();

/** @public */
export function I18nProvider(props: ParentProps) {
  return <I18nContext value={createI18n()}>{props.children}</I18nContext>;
}

/**
 * The i18n context. Throws `ContextNotFoundError` outside `I18nProvider`.
 *
 * @public
 */
export function useI18n(): I18n {
  return useContext(I18nContext);
}
