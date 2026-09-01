import { isServer } from "@solidjs/web";
import { createSignal } from "solid-js";
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
    // private mode / disabled storage — fall through to the navigator
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

const [locale, setLocaleSignal] = createSignal<Locale>(storedLocale());

/**
 * The current UI locale, reactive.
 *
 * @public
 */
export { locale };

/**
 * @public
 */
export function setLocale(next: Locale): void {
  setLocaleSignal(next);
  if (isServer) return;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // private mode / disabled storage — the in-memory locale still applies
  }
}

const dictionaries: Record<Locale, Record<MessageKey, string>> = { en, ja };

/**
 * Translate a message key in the current locale. `{name}` placeholders are
 * replaced from `params`. Reading it inside JSX (or any tracking scope)
 * subscribes to locale changes.
 *
 * @public
 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = dictionaries[locale()][key];
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (whole, name: string) =>
        name in params ? String(params[name]) : whole,
      );
}
