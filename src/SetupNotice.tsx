import { useI18n } from "./i18n";

export function SetupNotice() {
  const { t } = useI18n();
  return <p class="text-sm text-ink-muted">{t("app.setupConvex")}</p>;
}
