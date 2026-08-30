import { createEffect, createSignal } from "solid-js";

type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "cobracket:theme";
const ORDER: ThemePreference[] = ["system", "light", "dark"];
const LABELS: Record<ThemePreference, string> = {
  system: "Auto",
  light: "Light",
  dark: "Dark",
};

function storedPreference(): ThemePreference {
  // Guarded because the static shell is prerendered at build time.
  if (typeof localStorage === "undefined") return "system";
  const value = localStorage.getItem(STORAGE_KEY);
  return value === "light" || value === "dark" ? value : "system";
}

export default function ThemeToggle() {
  const [preference, setPreference] = createSignal(storedPreference());

  createEffect(
    () => preference(),
    (pref) => {
      // Forcing a single scheme flips every light-dark() token at once;
      // 'light dark' hands the choice back to the OS.
      document.documentElement.style.colorScheme = pref === "system" ? "light dark" : pref;
      localStorage.setItem(STORAGE_KEY, pref);
    },
  );

  const cycle = () => {
    setPreference((current) => ORDER[(ORDER.indexOf(current) + 1) % ORDER.length] ?? "system");
  };

  return (
    <button
      type="button"
      class="rounded-md border border-ink-muted/40 bg-surface-raised px-3 py-1 text-sm text-ink transition-colors hover:border-accent"
      onClick={cycle}
    >
      Theme: {LABELS[preference()]}
    </button>
  );
}
