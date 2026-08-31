import { t } from "./i18n";

// Rendered instead of any Convex-backed page when VITE_CONVEX_URL is not
// configured (createConvexQuery would otherwise stay pending forever).
export function SetupNotice() {
  return <p class="text-sm text-ink-muted">{t("app.setupConvex")}</p>;
}
