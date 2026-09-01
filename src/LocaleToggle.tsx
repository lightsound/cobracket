import { locale, setLocale, t } from "./i18n";

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
