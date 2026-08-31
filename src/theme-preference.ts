import { isServer } from "@solidjs/web";
import { createSignal } from "solid-js";

export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "cobracket:theme";
const ORDER: ThemePreference[] = ["system", "light", "dark"];

function readStoredTheme(): string | null {
  if (isServer) return null;
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
  if (isServer) return;
  document.documentElement.style.colorScheme = pref === "system" ? "light dark" : pref;
}

function persistPreference(pref: ThemePreference): void {
  if (isServer) return;
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // Private mode / disabled storage: the in-memory signal still updates.
  }
}

const initial = storedPreference();
const [themePreference, setThemePreference] = createSignal<ThemePreference>(initial);
applyPreference(initial);

export { themePreference };

export function cycleThemePreference(): void {
  const next = ORDER[(ORDER.indexOf(themePreference()) + 1) % ORDER.length] ?? "system";
  setThemePreference(next);
  applyPreference(next);
  persistPreference(next);
}
