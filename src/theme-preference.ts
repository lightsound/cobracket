import { createSignal } from "solid-js";

export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "cobracket:theme";
const ORDER: ThemePreference[] = ["system", "light", "dark"];

function readStoredTheme(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storedPreference(): ThemePreference {
  const value = readStoredTheme();
  return value === "light" || value === "dark" ? value : "system";
}

function applyPreference(pref: ThemePreference): void {
  // Forcing a single scheme flips every light-dark() token at once;
  // 'light dark' hands the choice back to the OS.
  document.documentElement.style.colorScheme = pref === "system" ? "light dark" : pref;
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // private mode / disabled storage — the scheme still applies
  }
}

const [themePreference, setThemePreferenceSignal] = createSignal(storedPreference());

export { themePreference };

function setThemePreference(pref: ThemePreference): void {
  setThemePreferenceSignal(pref);
  applyPreference(pref);
}

export function cycleThemePreference(): void {
  const next = ORDER[(ORDER.indexOf(themePreference()) + 1) % ORDER.length] ?? "system";
  setThemePreference(next);
}
