import { cycleThemePreference, themePreference, type ThemePreference } from "./theme-preference";

const LABELS: Record<ThemePreference, string> = {
  system: "Auto",
  light: "Light",
  dark: "Dark",
};

export default function ThemeToggle() {
  return (
    <button
      type="button"
      class="rounded-md border border-ink-muted/40 bg-surface-raised px-3 py-1 text-sm text-ink transition-colors hover:border-accent"
      onClick={() => cycleThemePreference()}
    >
      Theme: {LABELS[themePreference()]}
    </button>
  );
}
