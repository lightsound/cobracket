import { locale, setLocale, t } from "./i18n";

// The two MVP locales toggle back and forth; a menu can replace this when a
// third language lands. The label shows the language you would switch TO,
// in that language, the common convention for a two-locale switcher.
export default function LocaleToggle() {
  const next = () => (locale() === "en" ? "ja" : "en");
  return (
    <button
      type="button"
      class="rounded-md border border-ink-muted/40 bg-surface-raised px-3 py-1 text-sm text-ink transition-colors hover:border-accent"
      aria-label={t("locale.label")}
      onClick={() => setLocale(next())}
    >
      {next() === "ja" ? "日本語" : "English"}
    </button>
  );
}
