import { useI18n } from "./i18n";
import { useTheme, type ThemePreference } from "./theme-preference";

const LABEL_KEYS = {
  system: "theme.system",
  light: "theme.light",
  dark: "theme.dark",
} as const satisfies Record<ThemePreference, string>;

export default function ThemeToggle() {
  const { t } = useI18n();
  const { themePreference, cycleThemePreference } = useTheme();

  return (
    <button
      type="button"
      class="rounded-md border border-ink-muted/40 bg-surface-raised px-3 py-1 text-sm text-ink transition-colors hover:border-accent"
      onClick={() => cycleThemePreference()}
    >
      {t("theme.label")}: {t(LABEL_KEYS[themePreference()])}
    </button>
  );
}
