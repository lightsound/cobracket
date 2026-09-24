import { isServer } from "@solidjs/web";
import { createContext, createSignal, useContext, type Accessor, type ParentProps } from "solid-js";

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
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // private mode / disabled storage — the scheme still applies
  }
}

/**
 * The theme surface for one mounted app — per browser tab, per SSR request.
 * Components read it through `useTheme()`.
 */
export interface Theme {
  /** The current preference, reactive. */
  themePreference: Accessor<ThemePreference>;
  cycleThemePreference: () => void;
}

export function createThemePreference(): Theme {
  const [themePreference, setPreference] = createSignal(storedPreference());

  function setThemePreference(pref: ThemePreference): void {
    setPreference(pref);
    applyPreference(pref);
  }

  function cycleThemePreference(): void {
    const next = ORDER[(ORDER.indexOf(themePreference()) + 1) % ORDER.length] ?? "system";
    setThemePreference(next);
  }

  return { themePreference, cycleThemePreference };
}

const ThemeContext = createContext<Theme>();

export function ThemeProvider(props: ParentProps) {
  return <ThemeContext value={createThemePreference()}>{props.children}</ThemeContext>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
